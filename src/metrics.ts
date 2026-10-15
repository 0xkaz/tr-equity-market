import type { Bar } from "./yahoo";
import { sma, smaSeries, rsi, pctChange, maxOf, minOf, annVol, maxDrawdown, atr } from "./indicators";

export interface Metrics {
  date: string;
  close: number;
  bars: number;            // number of bars available
  chg1d: number | null;    // percent
  chg1w: number | null;
  chg1m: number | null;
  chg3m: number | null;
  chg6m: number | null;
  chg12m: number | null;
  chgYtd: number | null;
  mom12_1: number | null;  // 12-month return skipping the last month (classic momentum)
  sma20: number | null; sma50: number | null; sma200: number | null;
  vsSma20: number | null; vsSma50: number | null; vsSma200: number | null; // percent distance
  rsi14: number | null;
  hi52: number | null; lo52: number | null;
  fromHi52: number | null; fromLo52: number | null; // percent
  hi20: number | null;
  volume: number;
  avgVol20: number | null;
  volRatio: number | null;            // today's volume / 20d average
  turnover: number | null;            // close * avgVol20 (approx daily traded value, in quote currency)
  vol20: number | null;               // annualised volatility (%)
  atr14: number | null;
  atrPct: number | null;
  mdd1y: number | null;
  goldenCrossDays: number | null;     // days since sma50 crossed above sma200 (null if none within 30d)
  deadCrossDays: number | null;
  signals: string[];
}

const LOOK = { w: 5, m: 21, q: 63, h: 126, y: 252 };

export function computeMetrics(bars: Bar[]): Metrics | null {
  if (bars.length === 0) return null;
  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const vols = bars.map((b) => b.volume);
  const last = bars[bars.length - 1];
  const n = closes.length;

  const s20 = sma(closes, 20), s50 = sma(closes, 50), s200 = sma(closes, 200);
  const dist = (s: number | null) => (s ? (last.close / s - 1) * 100 : null);

  const hi52 = maxOf(highs, LOOK.y), lo52 = minOf(lows, LOOK.y);
  const prevHi52 = n > 1 ? maxOf(highs.slice(0, n - 1), LOOK.y) : null;
  const prevLo52 = n > 1 ? minOf(lows.slice(0, n - 1), LOOK.y) : null;
  const hi20 = n > 1 ? maxOf(closes.slice(0, n - 1), 20) : null; // prior 20-day closing high
  const lo20 = n > 1 ? minOf(closes.slice(0, n - 1), 20) : null;
  const avgVol20 = n >= 21 ? sma(vols.slice(0, n - 1), 20) : sma(vols, Math.min(20, n));
  const volRatio = avgVol20 ? last.volume / avgVol20 : null;

  // YTD
  const year = last.date.slice(0, 4);
  let ytdBase: number | null = null;
  for (let i = n - 1; i >= 0; i--) {
    if (bars[i].date.slice(0, 4) !== year) { ytdBase = bars[i].close; break; }
  }
  const chgYtd = ytdBase ? (last.close / ytdBase - 1) * 100 : null;

  // 12-1 momentum
  let mom12_1: number | null = null;
  if (n > LOOK.y) {
    const a = closes[n - 1 - LOOK.y], b = closes[n - 1 - LOOK.m];
    if (a > 0) mom12_1 = (b / a - 1) * 100;
  }

  // Cross detection (within last 30 days)
  const s50s = smaSeries(closes, 50), s200s = smaSeries(closes, 200);
  let goldenCrossDays: number | null = null, deadCrossDays: number | null = null;
  for (let i = n - 1; i >= Math.max(1, n - 30); i--) {
    const a0 = s50s[i - 1], b0 = s200s[i - 1], a1 = s50s[i], b1 = s200s[i];
    if (a0 == null || b0 == null || a1 == null || b1 == null) break;
    if (a0 <= b0 && a1 > b1 && goldenCrossDays == null) goldenCrossDays = n - 1 - i;
    if (a0 >= b0 && a1 < b1 && deadCrossDays == null) deadCrossDays = n - 1 - i;
  }

  const r = rsi(closes, 14);
  const a14 = atr(highs, lows, closes, 14);
  const chg1d = pctChange(closes, 1);
  const prevClose = n > 1 ? closes[n - 2] : null;

  const m: Metrics = {
    date: last.date,
    close: last.close,
    bars: n,
    chg1d,
    chg1w: pctChange(closes, LOOK.w),
    chg1m: pctChange(closes, LOOK.m),
    chg3m: pctChange(closes, LOOK.q),
    chg6m: pctChange(closes, LOOK.h),
    chg12m: pctChange(closes, LOOK.y),
    chgYtd,
    mom12_1,
    sma20: s20, sma50: s50, sma200: s200,
    vsSma20: dist(s20), vsSma50: dist(s50), vsSma200: dist(s200),
    rsi14: r,
    hi52, lo52,
    fromHi52: hi52 ? (last.close / hi52 - 1) * 100 : null,
    fromLo52: lo52 ? (last.close / lo52 - 1) * 100 : null,
    hi20,
    volume: last.volume,
    avgVol20,
    volRatio,
    turnover: avgVol20 ? avgVol20 * last.close : null,
    vol20: annVol(closes, 20),
    atr14: a14,
    atrPct: a14 ? (a14 / last.close) * 100 : null,
    mdd1y: maxDrawdown(closes, LOOK.y),
    goldenCrossDays, deadCrossDays,
    signals: [],
  };

  const sig: string[] = [];
  if (prevHi52 != null && last.close >= prevHi52 && n >= 120) sig.push("52W_HIGH");
  if (prevLo52 != null && last.close <= prevLo52 && n >= 120) sig.push("52W_LOW");
  if (hi20 != null && last.close > hi20 && n >= 25) sig.push("BREAKOUT_20D");
  if (lo20 != null && last.close < lo20 && n >= 25) sig.push("BREAKDOWN_20D");
  if (goldenCrossDays != null) sig.push("GOLDEN_CROSS");
  if (deadCrossDays != null) sig.push("DEAD_CROSS");
  if (r != null && r <= 30) sig.push("RSI_OVERSOLD");
  if (r != null && r >= 70) sig.push("RSI_OVERBOUGHT");
  if (volRatio != null && volRatio >= 2 && last.volume > 0) sig.push("VOLUME_SPIKE");
  if (s200 && prevClose != null && prevClose < (s200s[n - 2] ?? Infinity) && last.close > s200) sig.push("RECLAIM_SMA200");
  if (s200 && prevClose != null && prevClose > (s200s[n - 2] ?? -Infinity) && last.close < s200) sig.push("LOSE_SMA200");
  if (m.fromHi52 != null && m.fromHi52 <= -30) sig.push("DEEP_DRAWDOWN");
  if (s50 && s200 && last.close > s50 && s50 > s200) sig.push("UPTREND");
  if (s50 && s200 && last.close < s50 && s50 < s200) sig.push("DOWNTREND");
  if (chg1d != null && Math.abs(chg1d) >= 5) sig.push(chg1d > 0 ? "BIG_UP_DAY" : "BIG_DOWN_DAY");
  m.signals = sig;
  return m;
}

export const SIGNAL_LABELS: Record<string, string> = {
  "52W_HIGH": "52週高値更新",
  "52W_LOW": "52週安値更新",
  BREAKOUT_20D: "20日高値ブレイク",
  BREAKDOWN_20D: "20日安値割れ",
  GOLDEN_CROSS: "ゴールデンクロス",
  DEAD_CROSS: "デッドクロス",
  RSI_OVERSOLD: "RSI売られすぎ",
  RSI_OVERBOUGHT: "RSI買われすぎ",
  VOLUME_SPIKE: "出来高急増",
  RECLAIM_SMA200: "200日線回復",
  LOSE_SMA200: "200日線割れ",
  DEEP_DRAWDOWN: "高値から30%超下落",
  UPTREND: "上昇トレンド",
  DOWNTREND: "下降トレンド",
  BIG_UP_DAY: "急騰(+5%超)",
  BIG_DOWN_DAY: "急落(-5%超)",
};
