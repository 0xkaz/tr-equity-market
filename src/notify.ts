// Email notifications via Cloudflare Email Service (send_email binding).
import type { Env } from "./refresh";
import { ALERT_FIELDS, type AlertField, alertInputs, metConditions, parseState, formatState, describeCondition } from "./alerts";
import type { User } from "./auth";
import type { MarketSnapshot } from "./market";
import type { Metrics } from "./metrics";
import { SIGNAL_LABELS } from "./metrics";
import { shortNameOf } from "./market";

export interface SendEmailBinding {
  send(msg: { to: string | string[]; from: { email: string; name?: string } | string; subject: string; text?: string; html?: string }): Promise<{ messageId?: string } | void>;
}

export interface WatchRow {
  symbol: string; code: string; name: string | null; note: string | null; m: Metrics | null;
  hits?: AlertField[]; alert?: Record<string, number | null>; // conditions that became true since the previous evaluation
  alert_state?: string | null; nextState?: string | null;
}

// A user's watchlist with metrics and the alert conditions evaluated against metrics + fundamentals.
export async function loadWatchRows(db: D1Database, userId: string): Promise<WatchRow[]> {
  const rows = (await db.prepare(
    `SELECT w.symbol, t.code, t.name, w.note, ${ALERT_FIELDS.map((f) => "w." + f).join(", ")}, w.alert_state, m.json AS mjson, f.json AS fjson
     FROM user_watchlist w JOIN tickers t ON t.symbol = w.symbol LEFT JOIN metrics m ON m.symbol = w.symbol LEFT JOIN fundamentals f ON f.symbol = w.symbol
     WHERE w.user_id = ?1 ORDER BY t.code`,
  ).bind(userId).all<any>()).results ?? [];
  return rows.map((r: any) => {
    const m = r.mjson ? JSON.parse(r.mjson) : null, f = r.fjson ? JSON.parse(r.fjson) : null;
    const alert = Object.fromEntries(ALERT_FIELDS.map((k) => [k, r[k] ?? null]));
    const met = metConditions(alert, alertInputs(m, f));
    const prev = parseState(r.alert_state);
    return { symbol: r.symbol, code: r.code, name: r.name, note: r.note, m, alert, alert_state: r.alert_state ?? null, hits: met.filter((k) => !prev.includes(k)), nextState: formatState(met) };
  });
}

const pct = (v: number | null | undefined, d = 2) => (v == null ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const name = (r: { name: string | null; code: string }) => shortNameOf(r.name, r.code);

export function buildDailyEmail(user: User, snap: MarketSnapshot, watch: WatchRow[], publicUrl: string): { subject: string; text: string; html: string } | null {
  const wantSignals: string[] = (() => { try { return JSON.parse(user.notify_signals); } catch { return []; } })();
  const movePct = Number(user.notify_move_pct ?? 5);
  const base = publicUrl.replace(/\/$/, "");

  // Watchlist section
  const watchLines: string[] = [];
  const watchHtml: string[] = [];
  if (user.notify_watchlist) {
    for (const w of watch) {
      if (!w.m) continue;
      const flags: string[] = [];
      if (w.m.chg1d != null && Math.abs(w.m.chg1d) >= movePct) flags.push(`${w.m.chg1d > 0 ? "急騰" : "急落"} ${pct(w.m.chg1d)}`);
      for (const s of w.m.signals) if (s !== "UPTREND" && s !== "DOWNTREND" && s !== "BIG_UP_DAY" && s !== "BIG_DOWN_DAY") flags.push(SIGNAL_LABELS[s] ?? s);
      const line = `${name(w)} (${w.code}) ${w.m.close} ${pct(w.m.chg1d)}` + (flags.length ? ` — ${flags.join("、")}` : "");
      watchLines.push(line);
      watchHtml.push(`<tr><td><a href="${base}/#/stock/${w.code}">${esc(name(w))}</a> <span style="color:#888">${w.code}</span></td><td align="right">${w.m.close}</td><td align="right" style="color:${(w.m.chg1d ?? 0) >= 0 ? "#0f8a5f" : "#d13a3a"}">${pct(w.m.chg1d)}</td><td>${esc(flags.join("、"))}</td></tr>`);
    }
  }

  // Conditions the user set that newly became true
  const alertLines: string[] = [], alertHtml: string[] = [];
  for (const w of watch) {
    if (!w.hits?.length || !w.m) continue;
    const conds = w.hits.map((f) => describeCondition(f, w.alert![f]!)).join("、");
    alertLines.push(`${name(w)} (${w.code}): ${conds} に到達（株価 ${w.m.close}）${w.note ? ` — ${w.note}` : ""}`);
    alertHtml.push(`<li><a href="${base}/#/stock/${w.code}"><b>${esc(name(w))}</b></a> <span style="color:#888">${w.code}</span>: <b>${esc(conds)}</b> に到達 <span style="color:#555">（株価 ${w.m.close}）${w.note ? ` — ${esc(w.note)}` : ""}</span></li>`);
  }

  // Market-wide signal digest
  const sigLines: string[] = [];
  const sigHtml: string[] = [];
  for (const k of wantSignals) {
    const n = snap.signalCounts[k];
    if (!n) continue;
    const ex = (snap.signalExamples[k] ?? []).join("、");
    sigLines.push(`${SIGNAL_LABELS[k] ?? k}: ${n} 銘柄（${ex}）`);
    sigHtml.push(`<li><b>${esc(SIGNAL_LABELS[k] ?? k)}</b> ${n} 銘柄 <span style="color:#555">${esc(ex)}</span></li>`);
  }

  const hasWatchAlert = watchLines.some((l) => l.includes("—"));
  if (!user.notify_daily && !hasWatchAlert && sigLines.length === 0 && alertLines.length === 0) return null; // nothing worth sending

  const i = snap.index;
  const subjectParts = [`TR Equity ${snap.date}`];
  if (alertLines.length) subjectParts.push(`条件到達 ${alertLines.length} 件`);
  if (i) subjectParts.push(`BIST100 ${i.close.toFixed(2)} (${pct(i.chg1d)})`);
  if (hasWatchAlert) subjectParts.push("ウォッチ銘柄にアラート");
  const subject = subjectParts.join(" | ");

  const text = [
    `TR Equity Monitor — ${snap.date}`,
    "",
    ...(alertLines.length ? ["■ 設定した条件に到達", ...alertLines, ""] : []),
    ...(user.notify_daily ? [...(snap.aiBrief ? ["■ AIマーケットコメント", snap.aiBrief, ""] : []), "■ 数値サマリー", snap.brief, ""] : []),
    ...(watchLines.length ? ["■ ウォッチリスト", ...watchLines, ""] : []),
    ...(sigLines.length ? ["■ シグナル", ...sigLines, ""] : []),
    `ダッシュボード: ${base}/`,
    `通知設定の変更: ${base}/#/settings`,
  ].join("\n");

  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Hiragino Sans,sans-serif;font-size:14px;color:#222;max-width:680px;margin:0 auto;padding:16px">
  <h2 style="margin:0 0 4px">TR Equity Monitor <span style="font-weight:400;color:#888">${snap.date}</span></h2>
  ${i ? `<p style="font-size:18px;margin:4px 0 12px">BIST100 <b>${i.close.toFixed(2)}</b> <span style="color:${(i.chg1d ?? 0) >= 0 ? "#0f8a5f" : "#d13a3a"}">${pct(i.chg1d)}</span> <span style="color:#888;font-size:13px">週 ${pct(i.chg1w)} / 月 ${pct(i.chg1m)} / YTD ${pct(i.chgYtd)}</span></p>` : ""}
  ${alertHtml.length ? `<h3 style="margin:14px 0 6px;color:#b45309">設定した条件に到達</h3><ul style="padding-left:18px;line-height:1.7">${alertHtml.join("")}</ul>` : ""}
  ${user.notify_daily && snap.aiBrief ? `<h3 style="margin:14px 0 6px">AIマーケットコメント</h3><div style="white-space:pre-wrap;line-height:1.7">${esc(snap.aiBrief)}</div>` : ""}
  ${user.notify_daily ? `<h3 style="margin:14px 0 6px">数値サマリー</h3><div style="background:#f6f7f9;border-radius:8px;padding:12px;white-space:pre-wrap;line-height:1.6;font-size:13px">${esc(snap.brief)}</div>` : ""}
  ${user.notify_daily && snap.aiStocks?.length ? `<h3 style="margin:14px 0 6px">注目銘柄コメント</h3>${snap.aiStocks.map((s) => `<p style="margin:6px 0"><a href="${base}/#/stock/${s.code}"><b>${esc(name(s))}</b></a> <span style="color:#888">${s.code}</span><br>${esc(s.text)}</p>`).join("")}` : ""}
  ${watchHtml.length ? `<h3 style="margin:18px 0 6px">ウォッチリスト</h3><table cellpadding="6" style="border-collapse:collapse;width:100%;font-size:13px">${watchHtml.join("")}</table>` : ""}
  ${sigHtml.length ? `<h3 style="margin:18px 0 6px">本日のシグナル</h3><ul style="padding-left:18px;line-height:1.7">${sigHtml.join("")}</ul>` : ""}
  <p style="margin-top:20px"><a href="${base}/" style="background:#1d4ed8;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">ダッシュボードを開く</a></p>
  <p style="color:#888;font-size:12px">このメールは通知を有効にしているため送信されています。<a href="${base}/#/settings">通知設定</a>で変更できます。データは Yahoo Finance の遅延データに基づく参考情報です。</p>
  </body></html>`;
  return { subject, text, html };
}

export async function sendDailyNotifications(env: Env, snap: MarketSnapshot, opts: { force?: boolean; onlyUserId?: string } = {}): Promise<{ sent: number; skipped: number; errors: string[] }> {
  const db = env.DB;
  const result = { sent: 0, skipped: 0, errors: [] as string[] };
  if (!env.EMAIL || !env.EMAIL_FROM) { result.errors.push("EMAIL binding or EMAIL_FROM not configured"); return result; }
  const where = opts.onlyUserId ? "id = ?1" : "notify_email = 1";
  const q = db.prepare(`SELECT * FROM users WHERE ${where}`);
  const users = (await (opts.onlyUserId ? q.bind(opts.onlyUserId) : q).all<User>()).results ?? [];
  const publicUrl = env.PUBLIC_URL ?? "https://tr-equity.0xkaz.com";
  for (const u of users) {
    const already = await db.prepare("SELECT status FROM notifications WHERE user_id = ?1 AND kind = 'daily' AND ref_date = ?2").bind(u.id, snap.date).first<{ status: string }>();
    if (already?.status === "sent" && !opts.force) { result.skipped++; continue; }
    const watch = await loadWatchRows(db, u.id);
    const stateUpdates = watch.filter((w) => w.nextState !== w.alert_state)
      .map((w) => db.prepare("UPDATE user_watchlist SET alert_state = ?1 WHERE user_id = ?2 AND symbol = ?3").bind(w.nextState ?? null, u.id, w.symbol));
    const saveState = () => (stateUpdates.length ? db.batch(stateUpdates) : Promise.resolve([]));
    const mail = buildDailyEmail(u, snap, watch, publicUrl);
    const now = new Date().toISOString();
    if (!mail) {
      await db.prepare("INSERT OR REPLACE INTO notifications (user_id, kind, ref_date, sent_at, status, detail) VALUES (?1, 'daily', ?2, ?3, 'skipped', 'nothing to report')").bind(u.id, snap.date, now).run();
      await saveState();
      result.skipped++; continue;
    }
    try {
      const r = await env.EMAIL.send({ to: u.email, from: { email: env.EMAIL_FROM, name: "TR Equity Monitor" }, subject: mail.subject, text: mail.text, html: mail.html });
      await db.prepare("INSERT OR REPLACE INTO notifications (user_id, kind, ref_date, sent_at, status, detail) VALUES (?1, 'daily', ?2, ?3, 'sent', ?4)").bind(u.id, snap.date, now, JSON.stringify({ messageId: (r as any)?.messageId ?? null, subject: mail.subject })).run();
      await saveState(); // a failed send keeps the previous state so the crossing is reported next time
      result.sent++;
    } catch (e: any) {
      const msg = String(e?.message ?? e).slice(0, 500);
      await db.prepare("INSERT OR REPLACE INTO notifications (user_id, kind, ref_date, sent_at, status, detail) VALUES (?1, 'daily', ?2, ?3, 'error', ?4)").bind(u.id, snap.date, now, msg).run();
      result.errors.push(`${u.email}: ${msg}`);
    }
  }
  return result;
}
