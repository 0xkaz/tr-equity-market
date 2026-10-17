// GENERATED from 0xkaz/equity-hub core/status.ts (core 2026.10.17-1). Do not edit here: edit equity-hub/core and run scripts/sync-core.mjs.
// Standard health/freshness report served at GET /api/status by every sister site.
// The hub (equity.0xkaz.com) reads it daily to detect sites whose data stopped updating.
import { SITE } from "../site";
import { CORE_VERSION } from "./version";

export interface SiteStatus {
  site: string;              // site code from src/site.ts (US, JP, KSA, MACRO, ...)
  core: string;              // equity-hub core version synced into this site
  time: string;              // server time (ISO)
  dataDate: string | null;   // latest market date the site has a complete snapshot for (YYYY-MM-DD)
  updatedAt: string | null;  // when that snapshot was built (ISO)
  lastJobAt: string | null;  // latest job_log entry (ISO)
  lastJobKind: string | null;
  universe: number;          // active instruments
  stale: number;             // instruments not fetched within STALE_HOURS
  fetchErrors: number;       // instruments whose last fetch failed
  yahooPartialDropped24h?: number; // partial bars of an open session that the chart parser dropped (job_log, last 24 h)
  yahooFilled24h?: number;         // empty newest closes filled from the quote meta (job_log, last 24 h)
  aiRetries24h?: number;           // AI commentary attempts that were repeated because of an invented figure (job_log, last 24 h)
  aiDropped24h?: number;           // sentences removed from AI commentary for an invented figure (job_log, last 24 h)
}

export function baseStatus(partial: Partial<SiteStatus>): SiteStatus {
  return {
    site: SITE.code, core: CORE_VERSION, time: new Date().toISOString(),
    dataDate: null, updatedAt: null, lastJobAt: null, lastJobKind: null, universe: 0, stale: 0, fetchErrors: 0,
    ...partial,
  };
}

// Status for sites built on the tickers / market_daily / job_log schema (equity monitors, ETF trackers).
export async function tickerSiteStatus(db: D1Database, opts: { staleHours?: number } = {}): Promise<SiteStatus> {
  const cutoff = new Date(Date.now() - (opts.staleHours ?? 18) * 3600 * 1000).toISOString();
  const [snap, job, counts, notes] = await db.batch([
    db.prepare("SELECT date, created_at FROM market_daily ORDER BY date DESC LIMIT 1"),
    db.prepare("SELECT started_at, kind FROM job_log ORDER BY id DESC LIMIT 1"),
    db.prepare(`SELECT COUNT(*) AS n,
      SUM(CASE WHEN last_fetched_at IS NULL OR last_fetched_at < ?1 THEN 1 ELSE 0 END) AS stale,
      SUM(CASE WHEN fetch_error IS NOT NULL THEN 1 ELSE 0 END) AS errors
      FROM tickers WHERE active = 1`).bind(cutoff),
    // bounded by id (the primary key): job_log is never pruned and started_at has no index, so a plain
    // started_at filter scanned the whole table on every status call (the monitor polls every few minutes)
    db.prepare("SELECT detail FROM job_log WHERE id > (SELECT COALESCE(MAX(id), 0) - 500 FROM job_log) AND started_at > ?1 AND detail LIKE '%yahooNotes%'").bind(new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
  ]);
  // refresh jobs log {"yahooNotes":{"partialDropped":n,"filledFromMeta":n},...} first in their detail (see src/refresh.ts)
  let partial = 0, filled = 0, retries = 0, dropped = 0;
  for (const r of (notes.results ?? []) as { detail: string | null }[]) {
    partial += Number(/"partialDropped":(\d+)/.exec(r.detail ?? "")?.[1] ?? 0);
    filled += Number(/"filledFromMeta":(\d+)/.exec(r.detail ?? "")?.[1] ?? 0);
    retries += Number(/"aiGuard":\{"retries":(\d+)/.exec(r.detail ?? "")?.[1] ?? 0);
    dropped += Number(/"aiGuard":\{"retries":\d+,"dropped":(\d+)/.exec(r.detail ?? "")?.[1] ?? 0);
  }
  const s = (snap.results?.[0] ?? null) as { date: string; created_at: string } | null;
  const j = (job.results?.[0] ?? null) as { started_at: string; kind: string } | null;
  const c = (counts.results?.[0] ?? {}) as { n?: number; stale?: number; errors?: number };
  return baseStatus({
    dataDate: s?.date ?? null, updatedAt: s?.created_at ?? null,
    lastJobAt: j?.started_at ?? null, lastJobKind: j?.kind ?? null,
    universe: Number(c.n ?? 0), stale: Number(c.stale ?? 0), fetchErrors: Number(c.errors ?? 0),
    yahooPartialDropped24h: partial, yahooFilled24h: filled, aiRetries24h: retries, aiDropped24h: dropped,
  });
}
