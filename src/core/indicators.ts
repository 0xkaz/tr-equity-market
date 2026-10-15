// GENERATED from 0xkaz/equity-hub core/indicators.ts (core 2026.10.05). Do not edit here: edit equity-hub/core and run scripts/sync-core.mjs.
// Pure technical-indicator helpers over arrays of closes (oldest -> newest).

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let s = 0;
  for (let i = values.length - period; i < values.length; i++) s += values[i];
  return s / period;
}

export function smaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let s = 0;
  for (let i = 0; i < values.length; i++) {
    s += values[i];
    if (i >= period) s -= values[i - period];
    if (i >= period - 1) out[i] = s / period;
  }
  return out;
}

// Wilder RSI
export function rsi(values: number[], period = 14): number | null {
  if (values.length <= period) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

export function pctChange(values: number[], lookback: number): number | null {
  if (values.length <= lookback) return null;
  const a = values[values.length - 1 - lookback];
  const b = values[values.length - 1];
  if (!a) return null;
  return (b / a - 1) * 100;
}

export function maxOf(values: number[], n: number): number | null {
  if (values.length === 0) return null;
  const start = Math.max(0, values.length - n);
  let m = -Infinity;
  for (let i = start; i < values.length; i++) if (values[i] > m) m = values[i];
  return m;
}

export function minOf(values: number[], n: number): number | null {
  if (values.length === 0) return null;
  const start = Math.max(0, values.length - n);
  let m = Infinity;
  for (let i = start; i < values.length; i++) if (values[i] < m) m = values[i];
  return m;
}

// Annualised volatility of daily log returns over the last n days (percent)
export function annVol(values: number[], n = 20): number | null {
  if (values.length < n + 1) return null;
  const rets: number[] = [];
  for (let i = values.length - n; i < values.length; i++) {
    if (values[i - 1] > 0 && values[i] > 0) rets.push(Math.log(values[i] / values[i - 1]));
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v) * Math.sqrt(252) * 100;
}

// Max drawdown over last n closes (percent, negative)
export function maxDrawdown(values: number[], n: number): number | null {
  if (values.length === 0) return null;
  const start = Math.max(0, values.length - n);
  let peak = values[start], mdd = 0;
  for (let i = start; i < values.length; i++) {
    if (values[i] > peak) peak = values[i];
    const dd = (values[i] / peak - 1) * 100;
    if (dd < mdd) mdd = dd;
  }
  return mdd;
}

export function atr(high: number[], low: number[], close: number[], period = 14): number | null {
  if (close.length <= period) return null;
  const trs: number[] = [];
  for (let i = 1; i < close.length; i++) {
    trs.push(Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1])));
  }
  let a = trs.slice(0, period).reduce((x, y) => x + y, 0) / period;
  for (let i = period; i < trs.length; i++) a = (a * (period - 1) + trs[i]) / period;
  return a;
}

// Standard deviation of daily log returns over the last n closes (not annualised, fraction)
export function stdevLogReturns(values: number[], n: number): number | null {
  if (values.length < n + 1) return null;
  const rets: number[] = [];
  for (let i = values.length - n; i < values.length; i++) if (values[i - 1] > 0 && values[i] > 0) rets.push(Math.log(values[i] / values[i - 1]));
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  return Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1));
}

// Annualised Sharpe-like ratio (mean daily log return / stdev * sqrt(252)), risk-free ignored.
export function sharpe(values: number[], n: number): number | null {
  if (values.length < n + 1) return null;
  const rets: number[] = [];
  for (let i = values.length - n; i < values.length; i++) if (values[i - 1] > 0 && values[i] > 0) rets.push(Math.log(values[i] / values[i - 1]));
  if (rets.length < 20) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1));
  if (!sd) return null;
  return (mean / sd) * Math.sqrt(252);
}

// Percentile rank (0-100) of the last value within the last n values.
export function percentileRank(values: number[], n: number): number | null {
  if (values.length < 2) return null;
  const start = Math.max(0, values.length - n);
  const last = values[values.length - 1];
  let below = 0, count = 0;
  for (let i = start; i < values.length; i++) { count++; if (values[i] < last) below++; }
  return count ? Math.round((below / (count - 1 || 1)) * 100) : null;
}
