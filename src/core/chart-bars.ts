// GENERATED from 0xkaz/equity-hub core/chart-bars.ts (core 2026.10.16-2). Do not edit here: edit equity-hub/core and run scripts/sync-core.mjs.
// Daily bars from a Yahoo v8 chart result, shared by every site's src/yahoo.ts (fetchChart).
//  - While the regular session is still open Yahoo appends a partial bar for today; it is dropped, so metrics and
//    snapshots only ever come from completed sessions.
//  - After the session Yahoo sometimes leaves the newest daily close empty; the quote meta then carries the settled
//    regular price, which fills that one bar (open/high/low fall back to it, volume stays 0 until the next refresh
//    re-fetches the month and overwrites the bar).
// takeChartStats() returns (and resets) how often each case happened in this isolate; refresh jobs log it so the hub
// can show whether Yahoo is misbehaving.
export interface DailyBar { date: string; open: number; high: number; low: number; close: number; volume: number }
export interface ChartStats { partialDropped: number; filledFromMeta: number }

let stats: ChartStats = { partialDropped: 0, filledFromMeta: 0 };
export function takeChartStats(): ChartStats { const s = stats; stats = { partialDropped: 0, filledFromMeta: 0 }; return s; }

const round = (v: number) => Math.round(v * 10000) / 10000;
const num = (v: any, fallback: number) => (v == null || !isFinite(v) ? round(fallback) : round(v));
const toDate = (ts: number, gmtoffset: number) => new Date((ts + gmtoffset) * 1000).toISOString().slice(0, 10);

export function parseDailyBars(result: any, gmtoffset: number, nowSec: number = Date.now() / 1000): DailyBar[] {
  const meta = result?.meta ?? {};
  const ts: number[] = result?.timestamp ?? [];
  const q = result?.indicators?.quote?.[0] ?? {};
  const reg = meta.currentTradingPeriod?.regular;
  const sessionOpen = reg?.start != null && reg?.end != null && nowSec >= reg.start && nowSec < reg.end;
  const settledClose = !sessionOpen && meta.regularMarketPrice != null && isFinite(meta.regularMarketPrice) && meta.regularMarketTime != null ? Number(meta.regularMarketPrice) : null;
  const bars: DailyBar[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ts.length; i++) {
    if (sessionOpen && ts[i] >= reg.start) { if (q.close?.[i] != null) stats.partialDropped++; continue; }
    let c = q.close?.[i];
    if ((c == null || !isFinite(c)) && i === ts.length - 1 && settledClose != null && toDate(Number(meta.regularMarketTime), gmtoffset) === toDate(ts[i], gmtoffset)) { c = settledClose; stats.filledFromMeta++; }
    if (c == null || !isFinite(c)) continue;
    const date = toDate(ts[i], gmtoffset);
    if (seen.has(date)) continue; // guard against duplicate intraday stamp
    seen.add(date);
    bars.push({ date, open: num(q.open?.[i], c), high: num(q.high?.[i], c), low: num(q.low?.[i], c), close: round(c), volume: Math.round(q.volume?.[i] ?? 0) });
  }
  bars.sort((a, b) => (a.date < b.date ? -1 : 1));
  return bars;
}

// True while today's regular session has not ended yet. Yahoo's currentTradingPeriod.regular is the exchange-local day's session (checked
// 2026-10-16: still "today" after the close, and still today's session before the open), so a fetch for which this is true cannot hold
// today's final bar. refresh.ts then does not stamp last_fetched_at, otherwise the 18 h staleness gate would skip the first post-close
// run (AR was seeded at 06:56 UTC for a 20:00 UTC close and stayed a day behind).
export function isPreClose(meta: any, nowSec: number = Date.now() / 1000): boolean {
  const end = meta?.currentTradingPeriod?.regular?.end;
  return end != null && Number(end) > nowSec;
}
