// Data refresh jobs: fetch prices from Yahoo for stale tickers, recompute metrics,
// build the market snapshot once the whole universe is fresh.
import { UNIVERSE, symbolFor, INDEX_SYMBOL } from "./universe";
import { fetchChart, fetchFundamentals, type Bar } from "./yahoo";
import { takeChartStats, isPreClose } from "./core/chart-bars";
import { takeGuardStats } from "./core/ai-guard";
import { computeMetrics, type Metrics } from "./metrics";
import { buildSnapshot, type ScreenerRow, type MarketSnapshot } from "./market";
import { sendDailyNotifications } from "./notify";
import { runAiCommentary } from "./ai";
import { smaSeries, maxOf, minOf } from "./indicators";

export interface Env {
  DB: D1Database;
  EMAIL?: import("./notify").SendEmailBinding;
  AI?: import("./ai").AiBinding;
  EMAIL_FROM?: string;
  PUBLIC_URL?: string;
  ADMIN_TOKEN?: string;
  REFRESH_CHUNK?: string;
  STALE_HOURS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  ALLOWED_EMAILS?: string;
  ADMIN_EMAILS?: string;
}

export interface TickerRow {
  symbol: string; code: string; name: string | null; sector: string | null; kind: string; currency: string | null;
  active: number; last_fetched_at: string | null; last_price_date: string | null; fetch_error: string | null;
}

const HIST_BARS = 420; // bars to load for metric computation (~20 months)
const MAX_SQL_PARAMS = 100;

export async function ensureUniverse(db: D1Database): Promise<void> {
  const stmts = UNIVERSE.map((u) =>
    db.prepare("INSERT OR IGNORE INTO tickers (symbol, code, name, sector, kind) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(symbolFor(u), u.code, u.name ?? null, u.sector, u.kind ?? "equity"));
  // Tickers taken out of UNIVERSE (delisted / merged) stop being refreshed and listed; one that comes back is
  // re-activated. Only rows whose state changes are written.
  const keep = new Set(UNIVERSE.map((u) => symbolFor(u)));
  const { results } = await db.prepare("SELECT symbol, active FROM tickers").all<{ symbol: string; active: number }>();
  for (const r of results ?? []) {
    if (r.active && !keep.has(r.symbol)) stmts.push(db.prepare("UPDATE tickers SET active = 0 WHERE symbol = ?1").bind(r.symbol));
    else if (!r.active && keep.has(r.symbol)) stmts.push(db.prepare("UPDATE tickers SET active = 1 WHERE symbol = ?1").bind(r.symbol));
  }
  for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));
}

function chunkInsertPrices(db: D1Database, symbol: string, bars: Bar[]): D1PreparedStatement[] {
  const cols = 7;
  const perStmt = Math.floor(MAX_SQL_PARAMS / cols); // 14 rows
  const out: D1PreparedStatement[] = [];
  for (let i = 0; i < bars.length; i += perStmt) {
    const rows = bars.slice(i, i + perStmt);
    const placeholders = rows.map(() => "(?,?,?,?,?,?,?)").join(",");
    const params: (string | number)[] = [];
    for (const b of rows) params.push(symbol, b.date, b.open, b.high, b.low, b.close, b.volume);
    // Upsert that skips unchanged rows: each refresh re-sends about a month of bars, and INSERT OR REPLACE
    // bills every one of them as a delete + insert (3 rows written incl. the date index) even when nothing changed.
    out.push(db.prepare(`INSERT INTO prices (symbol,date,open,high,low,close,volume) VALUES ${placeholders} ON CONFLICT(symbol,date) DO UPDATE SET open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close, volume=excluded.volume WHERE prices.open IS NOT excluded.open OR prices.high IS NOT excluded.high OR prices.low IS NOT excluded.low OR prices.close IS NOT excluded.close OR prices.volume IS NOT excluded.volume`).bind(...params));
  }
  return out;
}

async function runBatched(db: D1Database, stmts: D1PreparedStatement[], size = 80): Promise<void> {
  for (let i = 0; i < stmts.length; i += size) await db.batch(stmts.slice(i, i + size));
}

export async function loadBars(db: D1Database, symbol: string, limit = HIST_BARS): Promise<Bar[]> {
  const { results } = await db.prepare(
    "SELECT date, open, high, low, close, volume FROM prices WHERE symbol = ?1 ORDER BY date DESC LIMIT ?2",
  ).bind(symbol, limit).all<Bar>();
  return (results ?? []).reverse();
}

export interface RefreshResult {
  processed: string[]; failed: { symbol: string; error: string }[]; remainingStale: number;
  snapshotBuilt: boolean; fundamentals?: number | string; notifications?: { sent: number; skipped: number; errors: string[] } | string;
  ai?: { brief: boolean; notes: number; errors: string[] } | string;
}

export async function runRefresh(env: Env, opts: { limit?: number; force?: boolean; symbols?: string[]; range?: string } = {}): Promise<RefreshResult> {
  const db = env.DB;
  const startedAt = new Date().toISOString();
  const limit = Math.max(1, Math.min(opts.limit ?? Number(env.REFRESH_CHUNK ?? 25), 60));
  const staleHours = Number(env.STALE_HOURS ?? 18);
  await ensureUniverse(db);

  const cutoff = new Date(Date.now() - staleHours * 3600 * 1000).toISOString();
  let targets: TickerRow[];
  if (opts.symbols?.length) {
    const qs = opts.symbols.map(() => "?").join(",");
    targets = (await db.prepare(`SELECT * FROM tickers WHERE active = 1 AND symbol IN (${qs})`).bind(...opts.symbols).all<TickerRow>()).results ?? [];
  } else {
    const where = opts.force ? "" : "AND (last_fetched_at IS NULL OR last_fetched_at < ?1)";
    const q = db.prepare(`SELECT * FROM tickers WHERE active = 1 ${where} ORDER BY last_fetched_at IS NOT NULL, last_fetched_at ASC LIMIT ${limit}`);
    targets = (await (opts.force ? q : q.bind(cutoff)).all<TickerRow>()).results ?? [];
  }

  const result: RefreshResult = { processed: [], failed: [], remainingStale: 0, snapshotBuilt: false };
  const now = new Date().toISOString();

  if (targets.length > 0) {
    // 1) Fetch from Yahoo in parallel. First-time tickers get 2y of history, otherwise 1mo (overlaps & repairs late revisions).
    const fetched = await Promise.allSettled(targets.map(async (t) => {
      const range = opts.range ?? (t.last_price_date ? "1mo" : "2y");
      const { meta, bars } = await fetchChart(t.symbol, range);
      return { t, meta, bars };
    }));

    const priceStmts: D1PreparedStatement[] = [];
    const ok: { t: TickerRow; name: string | null; currency: string | null; bars: Bar[]; preClose: boolean }[] = [];
    fetched.forEach((f, i) => {
      const t = targets[i];
      if (f.status === "fulfilled") {
        const name = f.value.meta.longName ?? f.value.meta.shortName ?? t.name ?? null;
        ok.push({ t, name, currency: f.value.meta.currency ?? null, bars: f.value.bars, preClose: isPreClose(f.value.meta) });
        priceStmts.push(...chunkInsertPrices(db, t.symbol, f.value.bars));
      } else {
        result.failed.push({ symbol: t.symbol, error: String(f.reason?.message ?? f.reason) });
      }
    });
    await runBatched(db, priceStmts);

    // 2) Load history for metric computation (one batch) and compute.
    // D1 rejects an empty batch, so guard against every fetch having failed.
    const hist = ok.length ? await db.batch(ok.map(({ t }) =>
      db.prepare("SELECT date, open, high, low, close, volume FROM prices WHERE symbol = ?1 ORDER BY date DESC LIMIT ?2").bind(t.symbol, HIST_BARS))) : [];
    const metricStmts: D1PreparedStatement[] = [];
    const tickerStmts: D1PreparedStatement[] = [];
    ok.forEach(({ t, name, currency, preClose }, i) => {
      const bars = ((hist[i].results ?? []) as Bar[]).reverse();
      const m = computeMetrics(bars);
      if (m) {
        metricStmts.push(db.prepare("INSERT INTO metrics (symbol, date, json, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(symbol) DO UPDATE SET date = excluded.date, json = excluded.json, updated_at = excluded.updated_at WHERE metrics.date IS NOT excluded.date OR metrics.json IS NOT excluded.json").bind(t.symbol, m.date, JSON.stringify(m), now));
      }
      tickerStmts.push(preClose
        // before today's close: keep the previous last_fetched_at so the first post-close run is not skipped by the staleness gate (isPreClose in core/chart-bars.ts)
        ? db.prepare("UPDATE tickers SET name = COALESCE(?1, name), currency = COALESCE(?2, currency), last_price_date = ?3, fetch_error = NULL WHERE symbol = ?4").bind(name, currency, m?.date ?? t.last_price_date, t.symbol)
        : db.prepare("UPDATE tickers SET name = COALESCE(?1, name), currency = COALESCE(?2, currency), last_fetched_at = ?3, last_price_date = ?4, fetch_error = NULL WHERE symbol = ?5")
          .bind(name, currency, now, m?.date ?? t.last_price_date, t.symbol));
      result.processed.push(t.symbol);
    });
    for (const f of result.failed) {
      tickerStmts.push(db.prepare("UPDATE tickers SET last_fetched_at = ?1, fetch_error = ?2 WHERE symbol = ?3").bind(now, f.error.slice(0, 300), f.symbol));
    }
    await runBatched(db, [...metricStmts, ...tickerStmts]);
    if (ok.some((o) => o.preClose)) (result as any).preClose = ok.filter((o) => o.preClose).length; // fetched before today's close: not counted as fresh
  }

  // 3) Remaining stale count; build snapshot when the universe is fresh.
  const rem = await db.prepare("SELECT COUNT(*) AS c FROM tickers WHERE active = 1 AND (last_fetched_at IS NULL OR last_fetched_at < ?1)").bind(cutoff).first<{ c: number }>();
  result.remainingStale = rem?.c ?? 0;
  if (result.remainingStale === 0) {
    const snap = await rebuildSnapshot(db);
    result.snapshotBuilt = Boolean(snap);
    if (snap) {
      // First snapshot on a new site: rebuild the breadth history from the 2y of stored prices
      // (otherwise this is a manual POST /api/admin/breadth-backfill step after the initial load).
      try {
        const h = await db.prepare("SELECT COUNT(*) AS c FROM breadth_daily").first<{ c: number }>();
        if ((h?.c ?? 0) < 20) (result as any).breadthBackfill = await backfillBreadth(db, 260);
      } catch (e: any) { (result as any).breadthBackfill = `error: ${e?.message ?? e}`; }
      if (env.AI && !snap.aiBrief) {
        try { result.ai = await runAiCommentary(env, snap, await loadScreener(db)); } catch (e: any) { result.ai = `error: ${e?.message ?? e}`; }
      }
      try { result.notifications = await sendDailyNotifications(env, snap); } catch (e: any) { result.notifications = `error: ${e?.message ?? e}`; }
    }
    // refresh fundamentals once per day, after the snapshot (3 subrequests)
    try {
      const f = await db.prepare("SELECT MAX(updated_at) AS u FROM fundamentals").first<{ u: string | null }>();
      if (!f?.u || f.u < cutoff) result.fundamentals = await refreshFundamentals(db);
    } catch (e: any) { result.fundamentals = `error: ${e?.message ?? e}`; }
  }

  await db.prepare("INSERT INTO job_log (started_at, finished_at, kind, detail) VALUES (?1, ?2, ?3, ?4)")
    .bind(startedAt, new Date().toISOString(), opts.symbols ? "refresh:symbols" : opts.force ? "refresh:force" : "refresh", JSON.stringify({ yahooNotes: takeChartStats(), aiGuard: takeGuardStats(), ...result }).slice(0, 4000)).run();
  return result;
}

export async function loadScreener(db: D1Database): Promise<ScreenerRow[]> {
  const { results } = await db.prepare(
    `SELECT t.symbol, t.code, t.name, t.sector, t.kind, t.currency, m.json AS mjson, f.json AS fjson
     FROM tickers t LEFT JOIN metrics m ON m.symbol = t.symbol LEFT JOIN fundamentals f ON f.symbol = t.symbol
     WHERE t.active = 1`).all<{ symbol: string; code: string; name: string | null; sector: string | null; kind: string; currency: string | null; mjson: string | null; fjson: string | null }>();
  return (results ?? []).filter((r) => r.mjson).map((r) => ({
    symbol: r.symbol, code: r.code, name: r.name, sector: r.sector, kind: r.kind, currency: r.currency,
    m: JSON.parse(r.mjson!) as Metrics, f: r.fjson ? JSON.parse(r.fjson) : null,
  }));
}

export async function rebuildSnapshot(db: D1Database): Promise<MarketSnapshot | null> {
  const rows = await loadScreener(db);
  const idx = rows.find((r) => r.symbol === INDEX_SYMBOL) ?? null;
  // snapshot date = most common latest metrics date among equities
  const dates = new Map<string, number>();
  for (const r of rows) if (r.kind === "equity") dates.set(r.m.date, (dates.get(r.m.date) ?? 0) + 1);
  const date = [...dates.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!date) return null;
  const snap = buildSnapshot(rows, idx, date);
  const prev = await db.prepare("SELECT json FROM market_daily WHERE date = ?1").bind(date).first<{ json: string }>();
  if (prev) { try { const pj = JSON.parse(prev.json); if (pj.aiBrief) { snap.aiBrief = pj.aiBrief; snap.aiModel = pj.aiModel; snap.aiGeneratedAt = pj.aiGeneratedAt; snap.aiStocks = pj.aiStocks; } } catch {} }
  const b = snap.breadth;
  await db.batch([
    db.prepare("INSERT INTO market_daily (date, json, created_at) VALUES (?1, ?2, ?3) ON CONFLICT(date) DO UPDATE SET json = excluded.json, created_at = excluded.created_at WHERE market_daily.json IS NOT excluded.json").bind(date, JSON.stringify(snap), new Date().toISOString()),
    db.prepare(`INSERT INTO breadth_daily (date, n, advancers, decliners, above_sma20, above_sma50, above_sma200, new_hi52, new_lo52, index_close, median_chg1d)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) ON CONFLICT(date) DO UPDATE SET n = excluded.n, advancers = excluded.advancers, decliners = excluded.decliners, above_sma20 = excluded.above_sma20, above_sma50 = excluded.above_sma50, above_sma200 = excluded.above_sma200, new_hi52 = excluded.new_hi52, new_lo52 = excluded.new_lo52, index_close = excluded.index_close, median_chg1d = excluded.median_chg1d WHERE breadth_daily.n IS NOT excluded.n OR breadth_daily.advancers IS NOT excluded.advancers OR breadth_daily.decliners IS NOT excluded.decliners OR breadth_daily.above_sma20 IS NOT excluded.above_sma20 OR breadth_daily.above_sma50 IS NOT excluded.above_sma50 OR breadth_daily.above_sma200 IS NOT excluded.above_sma200 OR breadth_daily.new_hi52 IS NOT excluded.new_hi52 OR breadth_daily.new_lo52 IS NOT excluded.new_lo52 OR breadth_daily.index_close IS NOT excluded.index_close OR breadth_daily.median_chg1d IS NOT excluded.median_chg1d`)
      .bind(date, b.n, b.advancers, b.decliners, b.aboveSma20, b.aboveSma50, b.aboveSma200, b.newHi52, b.newLo52, snap.index?.close ?? null, b.medianChg1d),
  ]);
  return snap;
}

// Rebuild breadth_daily for the last `days` trading days from stored prices.
export async function backfillBreadth(db: D1Database, days = 260): Promise<number> {
  const { results } = await db.prepare("SELECT symbol, kind FROM tickers WHERE active = 1").all<{ symbol: string; kind: string }>();
  const equities = (results ?? []).filter((r) => r.kind === "equity").map((r) => r.symbol);
  const limit = days + 260; // need 200 bars of history before the first evaluated day
  const hist = await Promise.all(equities.map(async (s) => ((await db.prepare("SELECT date, close, high, low FROM prices WHERE symbol = ?1 ORDER BY date DESC LIMIT ?2").bind(s, limit).all<{ date: string; close: number; high: number; low: number }>()).results ?? []).reverse()));
  const idxBars = ((await db.prepare("SELECT date, close FROM prices WHERE symbol = ?1 ORDER BY date DESC LIMIT ?2").bind(INDEX_SYMBOL, days).all<{ date: string; close: number }>()).results ?? []).reverse();
  const idxClose = new Map(idxBars.map((b) => [b.date, b.close]));

  type Day = { adv: number; dec: number; a20: number; a50: number; a200: number; hi: number; lo: number; n: number; chg: number[] };
  const byDate = new Map<string, Day>();
  for (const bars of hist) {
    if (bars.length < 30) continue;
    const closes = bars.map((b) => b.close);
    const s20 = smaSeries(closes, 20), s50 = smaSeries(closes, 50), s200 = smaSeries(closes, 200);
    const start = Math.max(1, bars.length - days);
    for (let i = start; i < bars.length; i++) {
      const d = bars[i].date;
      let day = byDate.get(d);
      if (!day) { day = { adv: 0, dec: 0, a20: 0, a50: 0, a200: 0, hi: 0, lo: 0, n: 0, chg: [] }; byDate.set(d, day); }
      const c = closes[i], p = closes[i - 1];
      day.n++;
      if (c > p) day.adv++; else if (c < p) day.dec++;
      day.chg.push(p ? (c / p - 1) * 100 : 0);
      if (s20[i] != null && c > s20[i]!) day.a20++;
      if (s50[i] != null && c > s50[i]!) day.a50++;
      if (s200[i] != null && c > s200[i]!) day.a200++;
      if (i >= 120) {
        const prevHi = maxOf(bars.slice(Math.max(0, i - 252), i).map((b) => b.high), 252);
        const prevLo = minOf(bars.slice(Math.max(0, i - 252), i).map((b) => b.low), 252);
        if (prevHi != null && c >= prevHi) day.hi++;
        if (prevLo != null && c <= prevLo) day.lo++;
      }
    }
  }
  const stmts: D1PreparedStatement[] = [];
  const covered = hist.filter((b) => b.length >= 30).length; // equities that actually have history
  for (const [date, d] of byDate) {
    if (d.n < covered * 0.5) continue; // skip partial days (holidays for most)
    const sorted = [...d.chg].sort((a, b) => a - b);
    const med = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null;
    stmts.push(db.prepare(`INSERT INTO breadth_daily (date, n, advancers, decliners, above_sma20, above_sma50, above_sma200, new_hi52, new_lo52, index_close, median_chg1d)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) ON CONFLICT(date) DO UPDATE SET n = excluded.n, advancers = excluded.advancers, decliners = excluded.decliners, above_sma20 = excluded.above_sma20, above_sma50 = excluded.above_sma50, above_sma200 = excluded.above_sma200, new_hi52 = excluded.new_hi52, new_lo52 = excluded.new_lo52, index_close = excluded.index_close, median_chg1d = excluded.median_chg1d WHERE breadth_daily.n IS NOT excluded.n OR breadth_daily.advancers IS NOT excluded.advancers OR breadth_daily.decliners IS NOT excluded.decliners OR breadth_daily.above_sma20 IS NOT excluded.above_sma20 OR breadth_daily.above_sma50 IS NOT excluded.above_sma50 OR breadth_daily.above_sma200 IS NOT excluded.above_sma200 OR breadth_daily.new_hi52 IS NOT excluded.new_hi52 OR breadth_daily.new_lo52 IS NOT excluded.new_lo52 OR breadth_daily.index_close IS NOT excluded.index_close OR breadth_daily.median_chg1d IS NOT excluded.median_chg1d`).bind(date, d.n, d.adv, d.dec, d.a20, d.a50, d.a200, d.hi, d.lo, idxClose.get(date) ?? null, med == null ? null : Math.round(med * 100) / 100));
  }
  await runBatched(db, stmts, 50);
  return stmts.length;
}

export async function refreshFundamentals(db: D1Database): Promise<number> {
  const { results } = await db.prepare("SELECT symbol FROM tickers WHERE active = 1 AND kind = 'equity'").all<{ symbol: string }>();
  const symbols = (results ?? []).map((r) => r.symbol);
  const funds = await fetchFundamentals(symbols);
  const now = new Date().toISOString();
  const stmts = funds.map((f) => db.prepare("INSERT INTO fundamentals (symbol, json, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(symbol) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at").bind(f.symbol, JSON.stringify(f), now));
  await runBatched(db, stmts);
  return funds.length;
}
