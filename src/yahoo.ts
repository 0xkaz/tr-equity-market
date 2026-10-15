// Yahoo Finance data access (chart API for OHLCV, quote API for fundamentals).

export interface Bar {
  date: string; // YYYY-MM-DD in exchange timezone
  open: number; high: number; low: number; close: number; volume: number;
}

export interface ChartMeta {
  symbol: string;
  longName?: string;
  shortName?: string;
  currency?: string;
  regularMarketPrice?: number;
  gmtoffset?: number;
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

function toDate(ts: number, gmtoffset: number): string {
  return new Date((ts + gmtoffset) * 1000).toISOString().slice(0, 10);
}

export async function fetchChart(symbol: string, range: string): Promise<{ meta: ChartMeta; bars: Bar[] }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&events=split`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`yahoo chart ${symbol}: HTTP ${res.status}`);
  const json: any = await res.json();
  const err = json?.chart?.error;
  if (err) throw new Error(`yahoo chart ${symbol}: ${err.code ?? ""} ${err.description ?? ""}`.trim());
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`yahoo chart ${symbol}: empty result`);
  const meta: ChartMeta = result.meta ?? {};
  const gmtoffset = Number(meta.gmtoffset ?? 28800);
  const ts: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  const bars: Bar[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ts.length; i++) {
    const c = q.close?.[i];
    if (c == null || !isFinite(c)) continue;
    const date = toDate(ts[i], gmtoffset);
    if (seen.has(date)) continue; // guard against duplicate intraday stamp
    seen.add(date);
    bars.push({
      date,
      open: num(q.open?.[i], c), high: num(q.high?.[i], c), low: num(q.low?.[i], c),
      close: round(c), volume: Math.round(q.volume?.[i] ?? 0),
    });
  }
  bars.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { meta, bars };
}

function num(v: any, fallback: number): number {
  return v == null || !isFinite(v) ? round(fallback) : round(v);
}
function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}

// ---- Fundamentals via v7 quote (requires cookie + crumb) ----

export interface Fundamentals {
  symbol: string;
  marketCap?: number;
  trailingPE?: number;
  forwardPE?: number;
  priceToBook?: number;
  dividendYield?: number;       // percent
  trailingAnnualDividendRate?: number;
  epsTrailing?: number;
  epsForward?: number;
  averageDailyVolume3Month?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  earningsTimestamp?: number;
  shortName?: string;
  longName?: string;
}

async function getCrumb(): Promise<{ cookie: string; crumb: string }> {
  const r1 = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA }, redirect: "manual" });
  const setCookie = r1.headers.get("set-cookie") ?? "";
  // keep only the name=value part of the first cookie(s)
  const cookie = setCookie.split(/,(?=[^;]+=)/).map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
  const r2 = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookie },
  });
  const crumb = (await r2.text()).trim();
  if (!r2.ok || !crumb || crumb.includes("<")) throw new Error(`yahoo crumb failed: HTTP ${r2.status}`);
  return { cookie, crumb };
}

// Yahoo's dividendYield sometimes disagrees badly with its own trailing dividend rate / price (stale or forward figures).
// Above 10% a yield that is more than 1.5x off that ratio is replaced by the ratio (rate and price share the quote unit, so
// this also holds for pence / agorot quotes); anything above 100% is impossible and dropped.
export function cleanYield(y: number | undefined, rate: number | undefined, price: number | undefined): number | undefined {
  if (y == null || !Number.isFinite(y)) return undefined;
  if (y > 10 && rate != null && rate > 0 && price != null && price > 0) {
    const implied = (rate / price) * 100;
    const ratio = y / implied;
    if (ratio > 1.5 || ratio < 1 / 1.5) y = implied;
  }
  return y > 100 ? undefined : y;
}

export async function fetchFundamentals(symbols: string[]): Promise<Fundamentals[]> {
  if (symbols.length === 0) return [];
  const { cookie, crumb } = await getCrumb();
  const out: Fundamentals[] = [];
  // Yahoo accepts many symbols per call; keep URL reasonable.
  for (let i = 0; i < symbols.length; i += 60) {
    const chunk = symbols.slice(i, i + 60);
    const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(chunk.join(","))}&crumb=${encodeURIComponent(crumb)}`;
    const res = await fetch(url, { headers: { "User-Agent": UA, Cookie: cookie, Accept: "application/json" } });
    if (!res.ok) throw new Error(`yahoo quote: HTTP ${res.status}`);
    const json: any = await res.json();
    for (const q of json?.quoteResponse?.result ?? []) {
      out.push({
        symbol: q.symbol,
        marketCap: q.marketCap,
        trailingPE: q.trailingPE,
        forwardPE: q.forwardPE,
        priceToBook: q.priceToBook,
        dividendYield: cleanYield(q.dividendYield ?? (q.trailingAnnualDividendYield != null ? q.trailingAnnualDividendYield * 100 : undefined), q.trailingAnnualDividendRate, q.regularMarketPrice),
        trailingAnnualDividendRate: q.trailingAnnualDividendRate,
        epsTrailing: q.epsTrailingTwelveMonths,
        epsForward: q.epsForward,
        averageDailyVolume3Month: q.averageDailyVolume3Month,
        fiftyTwoWeekHigh: q.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: q.fiftyTwoWeekLow,
        earningsTimestamp: q.earningsTimestamp,
        shortName: q.shortName,
        longName: q.longName,
      });
    }
  }
  return out;
}
