// GENERATED from 0xkaz/equity-hub core/chart-bars.ts (core 2026.10.26-1). Do not edit here: edit equity-hub/core and run scripts/sync-core.mjs.
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
// Local calendar date of a bar. Yahoo stamps a daily bar at its session start in exchange time, but meta.gmtoffset is today's
// offset only: after a DST change it moved bars stamped at local midnight (FX on the London day, futures and DX-Y.NYB on the
// New York day) to the previous date when a month was re-fetched (2026-10-26: GBPUSD=X of 10-23 came back as 10-22). The
// exchange time zone gives each bar its own offset; the fixed offset stays the fallback when Yahoo names no zone.
const dayFormat = new Map<string, Intl.DateTimeFormat>();
function zoneDate(ts: number, tz: string): string | null {
  try {
    let f = dayFormat.get(tz);
    if (!f) { f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }); dayFormat.set(tz, f); }
    const d = f.format(new Date(ts * 1000));
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  } catch { return null; }
}
const fixedDate = (ts: number, gmtoffset: number) => new Date((ts + gmtoffset) * 1000).toISOString().slice(0, 10);

export function parseDailyBars(result: any, gmtoffset: number, nowSec: number = Date.now() / 1000): DailyBar[] {
  const meta = result?.meta ?? {};
  const tz = typeof meta.exchangeTimezoneName === "string" && meta.exchangeTimezoneName ? meta.exchangeTimezoneName : null;
  const toDate = (t: number, off: number) => (tz && zoneDate(t, tz)) || fixedDate(t, off);
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
