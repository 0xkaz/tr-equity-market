import { Hono } from "hono";
import { isStockCode, stockPage, sitemapXml, stockIndexPage, type SeoStock } from "./seo";
import { SECTOR_JA as SEO_SECTOR_JA } from "./universe";
import { ALERT_FIELDS, parseAlertBody, metConditions, formatState, alertInputs } from "./alerts";
import { runRefresh, rebuildSnapshot, refreshFundamentals, loadScreener, loadBars, backfillBreadth, type Env, ensureUniverse } from "./refresh";
import { SIGNAL_LABELS, computeMetrics } from "./metrics";
import { INDEX_SYMBOL, INDEX_CODE, EXCHANGE_SUFFIX } from "./universe";
import { STATIC_FILES } from "./static.generated";
import { getUser, loginRedirect, handleCallback, logout, oauthConfigured, isAdminEmail, allowedEmails, type User } from "./auth";
import { sendDailyNotifications, buildDailyEmail, loadWatchRows } from "./notify";
import { runAiCommentary } from "./ai";
import { checkRefreshHealth, sendAdminAlert, alertRefreshException, DEFAULT_HEALTH } from "./alert";
import { tickerSiteStatus } from "./core/status";

type Vars = { user: User | null };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

const CACHE_SHORT = "public, max-age=120, s-maxage=300";
const NO_STORE = "private, no-store";

// Public market data is identical for every visitor: it skips the session lookup
// (one D1 read saved per request) and is cached at the edge (see edgeCached).
const PUBLIC_GET = /^\/api\/(market|screener|universe|stock\/[^/]+|health|meta)$/;
app.use("/api/*", async (c, next) => {
  const isPublic = c.req.method === "GET" && PUBLIC_GET.test(new URL(c.req.url).pathname);
  c.set("user", isPublic ? null : await getUser(c.env, c.req.raw));
  await next();
});

const EDGE_TTL = 300; // seconds; data changes once per trading day
async function edgeCached(c: any, build: () => Promise<Response>): Promise<Response> {
  const cache = (globalThis as any).caches?.default as Cache | undefined;
  const key = new Request(new URL(c.req.url).toString(), { method: "GET" });
  if (cache) {
    const hit = await cache.match(key);
    if (hit) { const r = new Response(hit.body, hit); r.headers.set("Cache-Control", CACHE_SHORT); r.headers.set("X-Edge-Cache", "HIT"); return r; }
  }
  const res = await build();
  if (cache && res.status === 200) {
    const stored = res.clone();
    const h = new Headers(stored.headers); h.set("Cache-Control", `public, max-age=${EDGE_TTL}`);
    c.executionCtx.waitUntil(cache.put(key, new Response(stored.body, { status: 200, headers: h })));
  }
  res.headers.set("X-Edge-Cache", "MISS");
  return res;
}

const MAX_WATCHLIST = 200;

function isAdmin(c: any): boolean {
  const token = c.env.ADMIN_TOKEN;
  const auth = c.req.header("authorization") ?? "";
  const given = c.req.header("x-admin-token") ?? (auth.startsWith("Bearer ") ? auth.slice(7) : "");
  if (token && given && given === token) return true;
  const u: User | null = c.get("user");
  return Boolean(u && isAdminEmail(c.env, u.email));
}
function requireAdmin(c: any): Response | null {
  return isAdmin(c) ? null : c.json({ error: "admin required (sign in with an admin account or send X-Admin-Token)" }, 401);
}
function requireUser(c: any): Response | null {
  return c.get("user") ? null : c.json({ error: "sign in required" }, 401);
}

function symbolFromCode(code: string): string {
  const c = code.toUpperCase();
  if (c === INDEX_CODE || c === INDEX_SYMBOL) return INDEX_SYMBOL;
  return c.endsWith(EXCHANGE_SUFFIX) ? c : `${c}${EXCHANGE_SUFFIX}`;
}

// ---------- Auth ----------
app.get("/auth/google/login", (c) => {
  if (!oauthConfigured(c.env)) return c.text("Google OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)", 503);
  return loginRedirect(c.env, c.req.url, c.req.query("next") ?? "/");
});
app.get("/auth/google/callback", (c) => handleCallback(c.env, c.req.raw));
app.get("/auth/logout", (c) => logout(c.env, c.req.raw));
app.post("/auth/logout", (c) => logout(c.env, c.req.raw));

app.get("/api/me", (c) => {
  const u = c.get("user");
  return c.json({
    user: u ? { id: u.id, email: u.email, name: u.name, picture: u.picture, admin: isAdminEmail(c.env, u.email) } : null,
    settings: u ? { notify_email: !!u.notify_email, notify_daily: !!u.notify_daily, notify_watchlist: !!u.notify_watchlist, notify_signals: safeJson(u.notify_signals, []), notify_move_pct: u.notify_move_pct } : null,
    oauthConfigured: oauthConfigured(c.env),
    emailConfigured: Boolean(c.env.EMAIL && c.env.EMAIL_FROM),
    restricted: Boolean(allowedEmails(c.env)),
  }, 200, { "Cache-Control": NO_STORE });
});

app.put("/api/me/settings", async (c) => {
  const denied = requireUser(c); if (denied) return denied;
  const u = c.get("user")!;
  const b = await c.req.json<any>().catch(() => ({}));
  const signals = Array.isArray(b.notify_signals) ? b.notify_signals.filter((s: any) => typeof s === "string" && s in SIGNAL_LABELS) : safeJson(u.notify_signals, []);
  const move = Number.isFinite(Number(b.notify_move_pct)) ? Math.min(Math.max(Number(b.notify_move_pct), 0.5), 50) : u.notify_move_pct;
  await c.env.DB.prepare("UPDATE users SET notify_email = ?1, notify_daily = ?2, notify_watchlist = ?3, notify_signals = ?4, notify_move_pct = ?5 WHERE id = ?6")
    .bind(b.notify_email ? 1 : 0, b.notify_daily === undefined ? u.notify_daily : (b.notify_daily ? 1 : 0), b.notify_watchlist === undefined ? u.notify_watchlist : (b.notify_watchlist ? 1 : 0), JSON.stringify(signals), move, u.id).run();
  return c.json({ ok: true });
});

app.get("/api/me/notifications", async (c) => {
  const denied = requireUser(c); if (denied) return denied;
  const { results } = await c.env.DB.prepare("SELECT kind, ref_date, sent_at, status, detail FROM notifications WHERE user_id = ?1 ORDER BY id DESC LIMIT 30").bind(c.get("user")!.id).all();
  return c.json({ items: results ?? [] }, 200, { "Cache-Control": NO_STORE });
});

// Send a test / preview of today's notification email to the signed-in user
app.post("/api/me/notifications/test", async (c) => {
  const denied = requireUser(c); if (denied) return denied;
  const u = c.get("user")!;
  const latest = await c.env.DB.prepare("SELECT json FROM market_daily ORDER BY date DESC LIMIT 1").first<{ json: string }>();
  if (!latest) return c.json({ error: "no market snapshot yet" }, 409);
  const r = await sendDailyNotifications(c.env, JSON.parse(latest.json), { force: true, onlyUserId: u.id });
  return c.json(r);
});

app.get("/api/me/notifications/preview", async (c) => {
  const denied = requireUser(c); if (denied) return denied;
  const u = c.get("user")!;
  const latest = await c.env.DB.prepare("SELECT json FROM market_daily ORDER BY date DESC LIMIT 1").first<{ json: string }>();
  if (!latest) return c.text("no market snapshot yet", 409);
  const watch = await loadWatchRows(c.env.DB, u.id); // preview only: alert_state is not updated
  const mail = buildDailyEmail(u, JSON.parse(latest.json), watch, c.env.PUBLIC_URL ?? "https://tr-equity.0xkaz.com");
  if (!mail) return c.text("（今日の設定では送信対象なし）", 200);
  return c.html(mail.html);
});

// ---------- Public data ----------
app.get("/api/health", (c) => c.json({ ok: true, time: new Date().toISOString() }));
app.get("/api/meta", (c) => c.json({ signals: SIGNAL_LABELS, adminEnabled: Boolean(c.env.ADMIN_TOKEN) || Boolean(c.env.ADMIN_EMAILS || c.env.ALLOWED_EMAILS) }));

app.get("/api/universe", (c) => edgeCached(c, async () => {
  const { results } = await c.env.DB.prepare("SELECT symbol, code, name, sector, kind, currency, active, last_fetched_at, last_price_date, fetch_error FROM tickers ORDER BY sector, code").all();
  return c.json({ tickers: results ?? [] }, 200, { "Cache-Control": CACHE_SHORT });
}));

app.get("/api/market", (c) => edgeCached(c, async () => {
  const db = c.env.DB;
  const latest = await db.prepare("SELECT date, json, created_at FROM market_daily ORDER BY date DESC LIMIT 1").first<{ date: string; json: string; created_at: string }>();
  const hist = await db.prepare("SELECT * FROM breadth_daily ORDER BY date DESC LIMIT 260").all<any>();
  const history = (hist.results ?? []).map((r) => ({
    date: r.date, index: r.index_close, n: r.n,
    aboveSma200: r.n ? Math.round((r.above_sma200 / r.n) * 100) : null,
    aboveSma50: r.n ? Math.round((r.above_sma50 / r.n) * 100) : null,
    aboveSma20: r.n ? Math.round((r.above_sma20 / r.n) * 100) : null,
    advancers: r.advancers, decliners: r.decliners, newHi52: r.new_hi52, newLo52: r.new_lo52, medianChg1d: r.median_chg1d,
  })).reverse();
  const indexBars = await loadBars(db, INDEX_SYMBOL, 260);
  return c.json({ snapshot: latest ? JSON.parse(latest.json) : null, generatedAt: latest?.created_at ?? null, history, indexBars }, 200, { "Cache-Control": CACHE_SHORT });
}));

// Same response for everyone; the client overlays its favorites from /api/watchlist/ids.
app.get("/api/screener", (c) => edgeCached(c, async () => {
  const rows = await loadScreener(c.env.DB);
  const eq = rows.filter((r) => r.kind === "equity");
  const rank = (key: "chg3m" | "chg6m" | "mom12_1" | "chg1m") => {
    const vals = eq.map((r) => r.m[key]).filter((v): v is number => v != null).sort((a, b) => a - b);
    return (v: number | null) => (v == null || vals.length === 0 ? null : Math.round((vals.findIndex((x) => x >= v) / vals.length) * 100));
  };
  const r1 = rank("chg1m"), r3 = rank("chg3m"), r6 = rank("chg6m"), r12 = rank("mom12_1");
  const out = rows.map((r) => {
    const p1 = r1(r.m.chg1m), p3 = r3(r.m.chg3m), p6 = r6(r.m.chg6m), p12 = r12(r.m.mom12_1);
    const parts = [p3, p6, p12].filter((x): x is number => x != null);
    const momScore = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null;
    return { ...r, rank: { chg1m: p1, chg3m: p3, chg6m: p6, mom12_1: p12 }, momScore };
  });
  return c.json({ rows: out, count: out.length }, 200, { "Cache-Control": CACHE_SHORT });
}));

app.get("/api/stock/:code", (c) => edgeCached(c, async () => {
  const symbol = symbolFromCode(c.req.param("code"));
  const db = c.env.DB;
  const t = await db.prepare("SELECT symbol, code, name, sector, kind, currency, last_fetched_at, last_price_date, fetch_error FROM tickers WHERE symbol = ?1").bind(symbol).first();
  if (!t) return c.json({ error: "unknown symbol" }, 404);
  const limit = Math.min(Number(c.req.query("bars") ?? 520), 1500);
  const [m, f, bars, ai] = await Promise.all([
    db.prepare("SELECT json FROM metrics WHERE symbol = ?1").bind(symbol).first<{ json: string }>(),
    db.prepare("SELECT json, updated_at FROM fundamentals WHERE symbol = ?1").bind(symbol).first<{ json: string; updated_at: string }>(),
    loadBars(db, symbol, limit),
    db.prepare("SELECT date, text, model FROM ai_notes WHERE symbol = ?1 ORDER BY date DESC LIMIT 5").bind(symbol).all<{ date: string; text: string; model: string }>(),
  ]);
  return c.json({ ticker: t, metrics: m ? JSON.parse(m.json) : null, fundamentals: f ? { ...JSON.parse(f.json), updatedAt: f.updated_at } : null, bars, aiNotes: ai.results ?? [] }, 200, { "Cache-Control": CACHE_SHORT });
}));

// ---------- Per-user watchlist ----------
app.get("/api/watchlist", async (c) => {
  const denied = requireUser(c); if (denied) return denied;
  const { results } = await c.env.DB.prepare(
    `SELECT w.symbol, w.note, w.added_at, ${ALERT_FIELDS.map((f) => "w." + f).join(", ")}, t.code, t.name, t.sector, t.currency, m.json AS mjson, f.json AS fjson FROM user_watchlist w
     JOIN tickers t ON t.symbol = w.symbol LEFT JOIN metrics m ON m.symbol = w.symbol LEFT JOIN fundamentals f ON f.symbol = w.symbol
     WHERE w.user_id = ?1 ORDER BY w.added_at DESC`).bind(c.get("user")!.id).all<any>();
  return c.json({ items: (results ?? []).map((r) => ({ ...r, m: r.mjson ? JSON.parse(r.mjson) : null, f: r.fjson ? JSON.parse(r.fjson) : null, mjson: undefined, fjson: undefined })) }, 200, { "Cache-Control": NO_STORE });
});

// Lightweight favorites state for list pages: symbols only, one primary-key range read.
app.get("/api/watchlist/ids", async (c) => {
  const u = c.get("user");
  if (!u) return c.json({ symbols: [] }, 200, { "Cache-Control": NO_STORE });
  const { results } = await c.env.DB.prepare("SELECT symbol FROM user_watchlist WHERE user_id = ?1").bind(u.id).all<{ symbol: string }>();
  return c.json({ symbols: (results ?? []).map((r) => r.symbol) }, 200, { "Cache-Control": NO_STORE });
});

app.get("/api/watchlist/:code", async (c) => {
  const denied = requireUser(c); if (denied) return denied;
  const symbol = symbolFromCode(c.req.param("code"));
  const row = await c.env.DB.prepare(`SELECT note, added_at, ${ALERT_FIELDS.join(", ")} FROM user_watchlist WHERE user_id = ?1 AND symbol = ?2`).bind(c.get("user")!.id, symbol).first<any>();
  const alerts = Object.fromEntries(ALERT_FIELDS.map((f) => [f, row?.[f] ?? null]));
  return c.json({ symbol, watched: Boolean(row), note: row?.note ?? null, added_at: row?.added_at ?? null, ...alerts }, 200, { "Cache-Control": NO_STORE });
});

// PUT with {} (star) adds without touching an existing row; {note} and alert_* fields update only what is present.
app.put("/api/watchlist/:code", async (c) => {
  const denied = requireUser(c); if (denied) return denied;
  const u = c.get("user")!;
  const symbol = symbolFromCode(c.req.param("code"));
  const raw = await c.req.json<any>().catch(() => ({}));
  const body = raw != null && typeof raw === "object" ? raw : {};
  const db = c.env.DB;
  const exists = await db.prepare("SELECT 1 FROM tickers WHERE symbol = ?1 AND kind = 'equity'").bind(symbol).first();
  if (!exists) return c.json({ error: "unknown symbol" }, 404);
  const [cnt, existing] = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM user_watchlist WHERE user_id = ?1").bind(u.id),
    db.prepare(`SELECT note, ${ALERT_FIELDS.join(", ")} FROM user_watchlist WHERE user_id = ?1 AND symbol = ?2`).bind(u.id, symbol),
  ]);
  const prev = existing.results?.[0] as any;
  if (!prev && Number((cnt.results?.[0] as any)?.n ?? 0) >= MAX_WATCHLIST) return c.json({ error: `ウォッチリストは最大 ${MAX_WATCHLIST} 銘柄です` }, 409);
  const hasNote = Object.prototype.hasOwnProperty.call(body, "note");
  const alerts = parseAlertBody(body, Object.fromEntries(ALERT_FIELDS.map((f) => [f, prev?.[f] ?? null])));
  if (alerts.error) return c.json({ error: alerts.error }, 400);
  if (prev && !hasNote && !alerts.changed) return c.json({ ok: true, symbol, watched: true }); // star on an existing row
  const note = hasNote ? (String(body.note ?? "").slice(0, 500) || null) : prev?.note ?? null;
  // conditions already met when saved are not e-mailed (the page shows them); only later crossings are
  let state: string | null | undefined;
  if (alerts.changed) {
    const [mr, fr] = await db.batch([
      db.prepare("SELECT json FROM metrics WHERE symbol = ?1").bind(symbol),
      db.prepare("SELECT json FROM fundamentals WHERE symbol = ?1").bind(symbol),
    ]);
    const mj = (mr.results?.[0] as any)?.json, fj = (fr.results?.[0] as any)?.json;
    state = formatState(metConditions(alerts.values, alertInputs(mj ? JSON.parse(mj) : null, fj ? JSON.parse(fj) : null)));
  }
  const v = alerts.values;
  await db.prepare(
    `INSERT INTO user_watchlist (user_id, symbol, note, added_at, alert_yield_above, alert_price_below, alert_price_above, alert_pe_below, alert_state)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT(user_id, symbol) DO UPDATE SET note = excluded.note, alert_yield_above = excluded.alert_yield_above, alert_price_below = excluded.alert_price_below,
       alert_price_above = excluded.alert_price_above, alert_pe_below = excluded.alert_pe_below${state !== undefined ? ", alert_state = excluded.alert_state" : ""}`)
    .bind(u.id, symbol, note, new Date().toISOString(), v.alert_yield_above ?? null, v.alert_price_below ?? null, v.alert_price_above ?? null, v.alert_pe_below ?? null, state ?? null).run();
  return c.json({ ok: true, symbol, watched: true });
});

app.delete("/api/watchlist/:code", async (c) => {
  const denied = requireUser(c); if (denied) return denied;
  const symbol = symbolFromCode(c.req.param("code"));
  await c.env.DB.prepare("DELETE FROM user_watchlist WHERE user_id = ?1 AND symbol = ?2").bind(c.get("user")!.id, symbol).run();
  return c.json({ ok: true, symbol });
});

// ---------- Admin ----------
app.get("/api/jobs", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, started_at, finished_at, kind, detail FROM job_log ORDER BY id DESC LIMIT 30").all();
  const stale = await c.env.DB.prepare("SELECT COUNT(*) AS c FROM tickers WHERE active = 1 AND (last_fetched_at IS NULL OR last_fetched_at < ?1)")
    .bind(new Date(Date.now() - Number(c.env.STALE_HOURS ?? 18) * 3600 * 1000).toISOString()).first<{ c: number }>();
  const errors = await c.env.DB.prepare("SELECT symbol, code, fetch_error, last_fetched_at FROM tickers WHERE fetch_error IS NOT NULL").all();
  const users = isAdmin(c) ? (await c.env.DB.prepare("SELECT email, name, last_login_at, notify_email FROM users ORDER BY last_login_at DESC").all()).results : undefined;
  return c.json({ jobs: results ?? [], stale: stale?.c ?? 0, errors: errors.results ?? [], users, isAdmin: isAdmin(c) }, 200, { "Cache-Control": NO_STORE });
});

app.post("/api/admin/refresh", async (c) => {
  const denied = requireAdmin(c); if (denied) return denied;
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
  const force = c.req.query("force") === "1";
  const range = c.req.query("range") ?? undefined;
  const symbols = c.req.query("symbols")?.split(",").filter(Boolean).map(symbolFromCode);
  return c.json(await runRefresh(c.env, { limit, force, range, symbols }));
});

app.post("/api/admin/snapshot", async (c) => {
  const denied = requireAdmin(c); if (denied) return denied;
  const snap = await rebuildSnapshot(c.env.DB);
  return c.json({ built: Boolean(snap), date: snap?.date ?? null });
});

app.post("/api/admin/notify", async (c) => {
  // Re-send today's notifications (force=1 re-sends even if already sent)
  const denied = requireAdmin(c); if (denied) return denied;
  const latest = await c.env.DB.prepare("SELECT json FROM market_daily ORDER BY date DESC LIMIT 1").first<{ json: string }>();
  if (!latest) return c.json({ error: "no snapshot" }, 409);
  return c.json(await sendDailyNotifications(c.env, JSON.parse(latest.json), { force: c.req.query("force") === "1" }));
});

// Send a plain test email to verify the Email Service binding / sending domain
app.post("/api/admin/email-test", async (c) => {
  const denied = requireAdmin(c); if (denied) return denied;
  const to = c.req.query("to");
  if (!to) return c.json({ error: "to required" }, 400);
  if (!c.env.EMAIL || !c.env.EMAIL_FROM) return c.json({ error: "EMAIL binding not configured" }, 503);
  try {
    const r = await c.env.EMAIL.send({ to, from: { email: c.env.EMAIL_FROM, name: "TR Equity Monitor" }, subject: "TR Equity Monitor テストメール", text: `送信テスト ${new Date().toISOString()}\n${c.env.PUBLIC_URL ?? ""}` });
    return c.json({ ok: true, result: r ?? null });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message ?? e) }, 502);
  }
});

// (Re)generate Workers AI commentary for the latest snapshot
app.post("/api/admin/ai", async (c) => {
  const denied = requireAdmin(c); if (denied) return denied;
  const latest = await c.env.DB.prepare("SELECT json FROM market_daily ORDER BY date DESC LIMIT 1").first<{ json: string }>();
  if (!latest) return c.json({ error: "no snapshot" }, 409);
  const snap = JSON.parse(latest.json);
  const r = await runAiCommentary(c.env, snap, await loadScreener(c.env.DB));
  return c.json({ ...r, aiBrief: snap.aiBrief ?? null, aiStocks: snap.aiStocks ?? [] });
});

app.post("/api/admin/breadth-backfill", async (c) => {
  const denied = requireAdmin(c); if (denied) return denied;
  const days = Math.min(Number(c.req.query("days") ?? 260), 500);
  return c.json({ rows: await backfillBreadth(c.env.DB, days) });
});

app.post("/api/admin/fundamentals", async (c) => {
  const denied = requireAdmin(c); if (denied) return denied;
  return c.json({ updated: await refreshFundamentals(c.env.DB) });
});

app.post("/api/admin/recompute", async (c) => {
  const denied = requireAdmin(c); if (denied) return denied;
  await ensureUniverse(c.env.DB);
  const { results } = await c.env.DB.prepare("SELECT symbol FROM tickers WHERE active = 1").all<{ symbol: string }>();
  const now = new Date().toISOString();
  let n = 0;
  const syms = (results ?? []).map((r) => r.symbol);
  for (let i = 0; i < syms.length; i += 30) {
    const chunk = syms.slice(i, i + 30);
    const hist = await c.env.DB.batch(chunk.map((s) => c.env.DB.prepare("SELECT date, open, high, low, close, volume FROM prices WHERE symbol = ?1 ORDER BY date DESC LIMIT 420").bind(s)));
    const stmts: D1PreparedStatement[] = [];
    chunk.forEach((s, j) => {
      const m = computeMetrics(((hist[j].results ?? []) as any[]).reverse());
      if (m) { n++; stmts.push(c.env.DB.prepare("INSERT INTO metrics (symbol, date, json, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(symbol) DO UPDATE SET date = excluded.date, json = excluded.json, updated_at = excluded.updated_at WHERE metrics.date IS NOT excluded.date OR metrics.json IS NOT excluded.json").bind(s, m.date, JSON.stringify(m), now)); }
    });
    if (stmts.length) await c.env.DB.batch(stmts);
  }
  const snap = await rebuildSnapshot(c.env.DB);
  return c.json({ recomputed: n, snapshotBuilt: Boolean(snap) });
});

// Admin alerts: dry-run the health check, or send a test alert to ADMIN_EMAILS
app.post("/api/admin/health-check", async (c) => {
  const denied = requireAdmin(c); if (denied) return denied;
  return c.json(await checkRefreshHealth(c.env, DEFAULT_HEALTH, { processed: 0, failed: 0 }, { send: c.req.query("send") === "1" }));
});
app.post("/api/admin/alert-test", async (c) => {
  const denied = requireAdmin(c); if (denied) return denied;
  return c.json(await sendAdminAlert(c.env, "test", "テスト通知", "管理者向けアラートのテスト送信です。定期更新で問題が起きたときは、このアドレスに通知が届きます。", { force: true }));
});

// Standard status for the equity-hub monitor (see src/core/status.ts)
app.get("/api/status", async (c) => c.json(await tickerSiteStatus(c.env.DB, { staleHours: Number((c.env as any).STALE_HOURS ?? 18) }), 200, { "Cache-Control": "no-store" }));

app.get("/api/*", (c) => c.json({ error: "not found" }, 404));

// Crawlable stock pages, the stock list and the sitemap (src/seo.ts); stock pages are the app shell with their own head tags
const SEO_SITE = "TR Equity Monitor";
app.get("/stock/:code", (c) => edgeCached(c, async () => {
  const code = c.req.param("code");
  const shell = STATIC_FILES["/index.html"];
  if (!isStockCode(code) || !shell) return c.text("not found", 404);
  const t = await c.env.DB.prepare(`SELECT t.code, t.name, t.sector, t.kind, t.currency, p.date, p.close FROM tickers t
    LEFT JOIN prices p ON p.symbol = t.symbol AND p.date = t.last_price_date WHERE t.code = ?1 AND t.active = 1`).bind(code).first<SeoStock>();
  if (!t) return c.text("not found", 404);
  return c.html(stockPage(shell.body, new URL(c.req.url).origin, t, SEO_SECTOR_JA, SEO_SITE), 200, { "Cache-Control": "public, max-age=3600" });
}));
app.get("/stocks", (c) => edgeCached(c, async () => {
  const { results } = await c.env.DB.prepare("SELECT code, name, sector FROM tickers WHERE active = 1 ORDER BY code").all<{ code: string; name: string | null; sector: string | null }>();
  return c.html(stockIndexPage(new URL(c.req.url).origin, SEO_SITE, results ?? [], SEO_SECTOR_JA), 200, { "Cache-Control": "public, max-age=3600" });
}));
app.get("/sitemap.xml", (c) => edgeCached(c, async () => {
  const { results } = await c.env.DB.prepare("SELECT code, last_price_date FROM tickers WHERE active = 1 ORDER BY code").all<{ code: string; last_price_date: string | null }>();
  return c.body(sitemapXml(new URL(c.req.url).origin, results ?? []), 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
}));

// Static dashboard (embedded at build time). Unknown paths fall back to index.html (SPA).
app.get("*", (c) => {
  const path = new URL(c.req.url).pathname;
  // a missing file or dot path (bot probes such as /.env, /.aws/credentials, /wp-login.php) is a 404, not the SPA page
  if (!STATIC_FILES[path] && (/\.[a-z0-9]{1,8}$/i.test(path) || path.includes("/."))) return c.text("not found", 404);
  const file = STATIC_FILES[path] ?? (path.endsWith("/") ? STATIC_FILES[path + "index.html"] : undefined) ?? STATIC_FILES["/index.html"];
  if (!file) return c.text("not found", 404);
  // the edge marks the ETag weak (W/"…") when it compresses the body, and browsers send it back that way
  if ((c.req.header("if-none-match") ?? "").split(",").some((t) => t.trim().replace(/^W\//, "") === file.etag)) return new Response(null, { status: 304, headers: { ETag: file.etag } });
  // URLs with the content hash (?v=, written into index.html by scripts/embed-static.mjs) never change: cache them a year
  const v = new URL(c.req.url).searchParams.get("v");
  const cc = v && file.etag.startsWith(`"${v}`) ? "public, max-age=31536000, immutable" : "public, max-age=300";
  return new Response(file.body, { headers: { "Content-Type": file.type, ETag: file.etag, "Cache-Control": cc } });
});

function safeJson<T>(s: string, fallback: T): T { try { return JSON.parse(s); } catch { return fallback; } }

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runRefresh(env)
      .then((r) => checkRefreshHealth(env, DEFAULT_HEALTH, { processed: r.processed.length, failed: r.failed.length }))
      .then((h) => { if (h.findings.length || h.errors.length) console.warn("refresh health", JSON.stringify(h)); })
      .catch((e) => { console.error("scheduled refresh failed", e); return alertRefreshException(env, e); }));
  },
};
