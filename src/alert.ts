// Admin alerts for the scheduled refresh. After every cron run the health of the data is
// checked in D1 and ADMIN_EMAILS get an e-mail when something needs attention:
//   - fetch-errors: many tickers failed to fetch in the current refresh window (Yahoo outage / API change)
//   - stale:        the latest market data has not advanced for ALERT_STALE_DAYS calendar days
//   - exception:    the refresh job itself threw
// Each kind is sent at most once per UTC day (deduplicated through job_log rows "alert:<kind>").
// This module only depends on DB / EMAIL / a few vars so the same file works in every sister site.

export interface AlertEnv {
  DB: D1Database;
  EMAIL?: { send(msg: { to: string; from: { email: string; name?: string }; subject: string; text?: string }): Promise<unknown> };
  EMAIL_FROM?: string;
  PUBLIC_URL?: string;
  ADMIN_EMAILS?: string;
  ALERT_ERROR_RATIO?: string; // share of active tickers with a fetch error in the window that triggers an alert (default 0.2)
  ALERT_STALE_DAYS?: string;  // calendar days without new market data that trigger an alert (default 7)
}

export interface HealthConfig {
  table: string;        // instrument table with last_fetched_at / fetch_error columns
  idCol: string;        // its id column
  activeWhere: string;  // SQL condition selecting tracked instruments
  latestDateSql: string; // SQL returning { d: "YYYY-MM-DD" } = latest market date stored
}

export const DEFAULT_HEALTH: HealthConfig = {
  table: "tickers", idCol: "symbol", activeWhere: "active = 1",
  latestDateSql: "SELECT MAX(date) AS d FROM market_daily",
};

const WINDOW_HOURS = 12; // failures older than this belong to a previous refresh window

export interface HealthFinding { kind: string; subject: string; body: string }
export interface HealthReport { findings: HealthFinding[]; sent: string[]; skipped: string[]; errors: string[] }

function siteName(env: AlertEnv): string {
  try { return env.PUBLIC_URL ? new URL(env.PUBLIC_URL).host : "equity monitor"; } catch { return "equity monitor"; }
}

export function adminRecipients(env: AlertEnv): string[] {
  return (env.ADMIN_EMAILS ?? "").split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));
}

export async function sendAdminAlert(env: AlertEnv, kind: string, subject: string, body: string, opts: { force?: boolean } = {}): Promise<{ sent: boolean; reason?: string }> {
  const to = adminRecipients(env);
  if (!to.length) return { sent: false, reason: "ADMIN_EMAILS not set" };
  if (!env.EMAIL || !env.EMAIL_FROM) return { sent: false, reason: "EMAIL binding or EMAIL_FROM not configured" };
  const db = env.DB;
  const now = new Date().toISOString();
  if (!opts.force) {
    const dup = await db.prepare("SELECT 1 FROM job_log WHERE kind = ?1 AND started_at >= ?2 LIMIT 1").bind(`alert:${kind}`, now.slice(0, 10)).first();
    if (dup) return { sent: false, reason: "already sent today" };
  }
  const site = siteName(env);
  const base = (env.PUBLIC_URL ?? "").replace(/\/$/, "");
  const text = `${body}\n\n状態ページ: ${base}/#/status\n\n（${site} の定期更新を監視して自動送信しています。同じ種類の通知は 1 日 1 回までです。）`;
  const errors: string[] = [];
  for (const addr of to) {
    try {
      await env.EMAIL.send({ to: addr, from: { email: env.EMAIL_FROM, name: `${site} alert` }, subject: `[要確認] ${site}: ${subject}`, text });
    } catch (e: any) { errors.push(`${addr}: ${String(e?.message ?? e).slice(0, 200)}`); }
  }
  const sent = errors.length < to.length;
  // Only successful sends count for deduplication, so a failed send is retried on the next run.
  await db.prepare("INSERT INTO job_log (started_at, finished_at, kind, detail) VALUES (?1, ?1, ?2, ?3)")
    .bind(now, sent ? `alert:${kind}` : `alert-failed:${kind}`, JSON.stringify({ subject, recipients: to.length, errors })).run();
  return sent ? { sent } : { sent, reason: errors.join("; ") };
}

// Inspect D1 after a refresh run. With send=false it only reports what it would send.
export async function checkRefreshHealth(env: AlertEnv, cfg: HealthConfig, run: { processed: number; failed: number }, opts: { send?: boolean } = {}): Promise<HealthReport> {
  const report: HealthReport = { findings: [], sent: [], skipped: [], errors: [] };
  const db = env.DB;
  try {
    const cutoff = new Date(Date.now() - WINDOW_HOURS * 3600 * 1000).toISOString();
    const ratio = Number(env.ALERT_ERROR_RATIO ?? 0.2);
    const row = await db.prepare(
      `SELECT COUNT(*) AS n, SUM(CASE WHEN fetch_error IS NOT NULL AND last_fetched_at >= ?1 THEN 1 ELSE 0 END) AS e FROM ${cfg.table} WHERE ${cfg.activeWhere}`,
    ).bind(cutoff).first<{ n: number; e: number | null }>();
    const n = row?.n ?? 0, e = row?.e ?? 0;
    if (n > 0 && e >= Math.max(3, Math.ceil(n * ratio))) {
      const { results } = await db.prepare(
        `SELECT ${cfg.idCol} AS id, fetch_error AS err FROM ${cfg.table} WHERE ${cfg.activeWhere} AND fetch_error IS NOT NULL AND last_fetched_at >= ?1 ORDER BY last_fetched_at DESC LIMIT 15`,
      ).bind(cutoff).all<{ id: string; err: string }>();
      report.findings.push({
        kind: "fetch-errors",
        subject: `データ取得エラー ${e}/${n} 件`,
        body: `直近 ${WINDOW_HOURS} 時間の定期更新で、${n} 件中 ${e} 件のデータ取得に失敗しています（最新の実行: 成功 ${run.processed} 件 / 失敗 ${run.failed} 件）。\n`
          + `データ元（Yahoo Finance など）の障害や仕様変更の可能性があります。失敗した銘柄は翌日の更新まで再取得されません。\n\n`
          + (results ?? []).map((r) => `- ${r.id}: ${String(r.err ?? "").slice(0, 160)}`).join("\n")
          + (e > (results?.length ?? 0) ? `\n…ほか ${e - (results?.length ?? 0)} 件` : ""),
      });
    }

    const staleDays = Number(env.ALERT_STALE_DAYS ?? 7);
    const latest = await db.prepare(cfg.latestDateSql).first<{ d: string | null }>().catch(() => null);
    if (latest?.d) {
      const age = Math.floor((Date.now() - Date.parse(`${latest.d.slice(0, 10)}T00:00:00Z`)) / 86400000);
      if (age > staleDays) {
        report.findings.push({
          kind: "stale",
          subject: `データが ${age} 日間更新されていません`,
          body: `保存されている最新のマーケットデータが ${latest.d}（${age} 日前）のままです。\n`
            + `定期更新は動いていますが、新しい日付のデータが届いていません。長期休場でなければ、データ元の障害や銘柄コードの変更を確認してください。`,
        });
      }
    }
  } catch (e: any) {
    report.errors.push(`check: ${e?.message ?? e}`);
  }
  if (opts.send !== false) {
    for (const f of report.findings) {
      const r = await sendAdminAlert(env, f.kind, f.subject, f.body).catch((e: any) => ({ sent: false, reason: String(e?.message ?? e) }));
      (r.sent ? report.sent : report.skipped).push(r.sent ? f.kind : `${f.kind}: ${r.reason}`);
    }
  }
  return report;
}

export async function alertRefreshException(env: AlertEnv, err: unknown): Promise<void> {
  const e = err as any;
  const msg = String(e?.stack ?? e?.message ?? e).slice(0, 1500);
  await sendAdminAlert(env, "exception", "定期更新が失敗しました", `定期更新の処理がエラーで停止しました。\n\n${msg}`).catch((x) => console.error("alert failed", x));
}
