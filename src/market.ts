// Market-wide aggregation: breadth, sector performance, movers and a Japanese daily brief.
import type { Metrics } from "./metrics";
import { SIGNAL_LABELS } from "./metrics";
import { SECTOR_JA } from "./universe";

export const sectorLabel = (s: string | null | undefined): string => (s ? (SECTOR_JA as Record<string, string>)[s] ?? s : "その他");

export interface ScreenerRow {
  symbol: string; code: string; name: string | null; sector: string | null; kind: string; currency?: string | null;
  m: Metrics;
  f?: Record<string, any> | null;
}

export interface MarketSnapshot {
  date: string;
  index: { close: number; chg1d: number | null; chg1w: number | null; chg1m: number | null; chg3m: number | null; chgYtd: number | null; chg12m: number | null; hi52: number | null; lo52: number | null; fromHi52: number | null; rsi14: number | null; vsSma50: number | null; vsSma200: number | null } | null;
  breadth: {
    n: number; advancers: number; decliners: number; unchanged: number;
    aboveSma20: number; aboveSma50: number; aboveSma200: number;
    newHi52: number; newLo52: number; uptrend: number; downtrend: number;
    medianChg1d: number | null; medianChg1m: number | null;
  };
  sectors: { sector: string; n: number; chg1d: number | null; chg1w: number | null; chg1m: number | null; chg3m: number | null; aboveSma200Pct: number | null }[];
  gainers: { code: string; name: string | null; chg1d: number; close: number }[];
  losers: { code: string; name: string | null; chg1d: number; close: number }[];
  signalCounts: Record<string, number>;
  signalExamples: Record<string, string[]>;
  brief: string;
  aiBrief?: string;
  aiModel?: string;
  aiGeneratedAt?: string;
  aiStocks?: { code: string; name: string | null; text: string }[];
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function mean(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => x != null && isFinite(x));
  if (v.length === 0) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}
const r2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);

export function buildSnapshot(rows: ScreenerRow[], indexRow: ScreenerRow | null, date: string): MarketSnapshot {
  const eq = rows.filter((r) => r.kind === "equity" && r.m.date === date);
  const im = indexRow?.m ?? null;
  const index = im ? {
    close: im.close, chg1d: r2(im.chg1d), chg1w: r2(im.chg1w), chg1m: r2(im.chg1m), chg3m: r2(im.chg3m),
    chgYtd: r2(im.chgYtd), chg12m: r2(im.chg12m), hi52: im.hi52, lo52: im.lo52, fromHi52: r2(im.fromHi52),
    rsi14: r2(im.rsi14), vsSma50: r2(im.vsSma50), vsSma200: r2(im.vsSma200),
  } : null;

  const breadth = {
    n: eq.length,
    advancers: eq.filter((r) => (r.m.chg1d ?? 0) > 0).length,
    decliners: eq.filter((r) => (r.m.chg1d ?? 0) < 0).length,
    unchanged: eq.filter((r) => (r.m.chg1d ?? 0) === 0).length,
    aboveSma20: eq.filter((r) => (r.m.vsSma20 ?? -1) > 0).length,
    aboveSma50: eq.filter((r) => (r.m.vsSma50 ?? -1) > 0).length,
    aboveSma200: eq.filter((r) => (r.m.vsSma200 ?? -1) > 0).length,
    newHi52: eq.filter((r) => r.m.signals.includes("52W_HIGH")).length,
    newLo52: eq.filter((r) => r.m.signals.includes("52W_LOW")).length,
    uptrend: eq.filter((r) => r.m.signals.includes("UPTREND")).length,
    downtrend: eq.filter((r) => r.m.signals.includes("DOWNTREND")).length,
    medianChg1d: r2(median(eq.map((r) => r.m.chg1d).filter((x): x is number => x != null))),
    medianChg1m: r2(median(eq.map((r) => r.m.chg1m).filter((x): x is number => x != null))),
  };

  const bySector = new Map<string, ScreenerRow[]>();
  for (const r of eq) {
    const s = r.sector ?? "Other";
    if (!bySector.has(s)) bySector.set(s, []);
    bySector.get(s)!.push(r);
  }
  const sectors = [...bySector.entries()].map(([sector, rs]) => ({
    sector, n: rs.length,
    chg1d: r2(mean(rs.map((r) => r.m.chg1d))),
    chg1w: r2(mean(rs.map((r) => r.m.chg1w))),
    chg1m: r2(mean(rs.map((r) => r.m.chg1m))),
    chg3m: r2(mean(rs.map((r) => r.m.chg3m))),
    aboveSma200Pct: rs.length ? r2((rs.filter((r) => (r.m.vsSma200 ?? -1) > 0).length / rs.length) * 100) : null,
  })).sort((a, b) => (b.chg1d ?? -999) - (a.chg1d ?? -999));

  const withChg = eq.filter((r) => r.m.chg1d != null && r.m.volume > 0);
  const gainers = [...withChg].sort((a, b) => b.m.chg1d! - a.m.chg1d!).slice(0, 8)
    .map((r) => ({ code: r.code, name: r.name, chg1d: r2(r.m.chg1d)!, close: r.m.close }));
  const losers = [...withChg].sort((a, b) => a.m.chg1d! - b.m.chg1d!).slice(0, 8)
    .map((r) => ({ code: r.code, name: r.name, chg1d: r2(r.m.chg1d)!, close: r.m.close }));

  const signalCounts: Record<string, number> = {};
  const signalExamples: Record<string, string[]> = {};
  for (const r of eq) for (const s of r.m.signals) {
    signalCounts[s] = (signalCounts[s] ?? 0) + 1;
    (signalExamples[s] ??= []);
    if (signalExamples[s].length < 6) signalExamples[s].push(`${shortName(r)}(${r.code})`);
  }

  const snap: MarketSnapshot = { date, index, breadth, sectors, gainers, losers, signalCounts, signalExamples, brief: "" };
  snap.brief = writeBrief(snap);
  return snap;
}

// "Tencent Holdings Limited" -> "Tencent", "BHP Group Limited" -> "BHP"
const NAME_SUFFIX = /[\s,]+(Public Company Limited|Group Holdings? (Limited|Ltd\.?)|Holdings? (Limited|Ltd\.?|plc)|Group (Limited|Ltd\.?|plc)|Company (Limited|Ltd\.?)|Co\.,? Ltd\.?|Corporation (Limited|Ltd\.?)|Limited|Ltd\.?|plc|Corporation|Corp\.?|Inc\.?|N\.V\.|S\.p\.A\.|SpA|S\.A\.D\.?|SAD|S\.G\.P\.S\.|SGPS|S\.A\.|SA|SE)\s*$/i;
export function shortNameOf(name: string | null, code: string): string {
  const full = (name ?? code).replace(/\s+\((Singapore|S|Holdings|Hong Kong|H Shares?|Australia)\)/gi, "").replace(/,\s*S\.A\.,.*$/i, "").replace(/\s+/g, " ").trim();
  let n = full;
  for (let i = 0; i < 3; i++) { const cut = n.replace(NAME_SUFFIX, "").trim(); if (!cut || cut === n) break; n = cut; }
  return n || full;
}

function shortName(r: ScreenerRow): string {
  return shortNameOf(r.name, r.code);
}

const pct = (v: number | null | undefined, digits = 2) => {
  if (v == null) return "n/a";
  const t = v.toFixed(digits);
  const zero = Number(t) === 0;
  return `${zero ? "" : v > 0 ? "+" : ""}${zero ? t.replace("-", "") : t}%`;
};
const WD = ["日", "月", "火", "水", "木", "金", "土"];

export function writeBrief(s: MarketSnapshot): string {
  const d = new Date(s.date + "T00:00:00Z");
  const dateJa = `${d.getUTCMonth() + 1}月${d.getUTCDate()}日(${WD[d.getUTCDay()]})`;
  const lines: string[] = [];
  if (s.index) {
    const i = s.index;
    const tone = i.chg1d == null ? "" : i.chg1d > 0.5 ? "上昇" : i.chg1d < -0.5 ? "下落" : "小動き";
    lines.push(`${dateJa} BIST100（BIST 100 指数）は ${i.close.toFixed(2)}（前日比 ${pct(i.chg1d)}）で${tone}。週間 ${pct(i.chg1w)}、月間 ${pct(i.chg1m)}、年初来 ${pct(i.chgYtd)}。52週高値から ${pct(i.fromHi52)}、RSI(14) は ${i.rsi14 ?? "n/a"}。` +
      (i.vsSma200 != null ? `指数は200日線を${i.vsSma200 >= 0 ? "上回って" : "下回って"}います（${pct(i.vsSma200)}）。` : ""));
  }
  const b = s.breadth;
  if (b.n > 0) {
    const p = (x: number) => Math.round((x / b.n) * 100);
    lines.push(`監視ユニバース ${b.n} 銘柄: 上昇 ${b.advancers} / 下落 ${b.decliners} / 変わらず ${b.unchanged}（中央値 ${pct(b.medianChg1d)}）。` +
      `200日線上 ${p(b.aboveSma200)}%、50日線上 ${p(b.aboveSma50)}%、上昇トレンド ${b.uptrend} 銘柄・下降トレンド ${b.downtrend} 銘柄。` +
      (b.newHi52 || b.newLo52 ? `52週高値更新 ${b.newHi52}、安値更新 ${b.newLo52}。` : ""));
  }
  if (s.sectors.length >= 2) {
    const top = s.sectors[0], bottom = s.sectors[s.sectors.length - 1];
    lines.push(`セクター: 最強 ${sectorLabel(top.sector)}（${pct(top.chg1d)}）、最弱 ${sectorLabel(bottom.sector)}（${pct(bottom.chg1d)}）。` +
      `月間では ${[...s.sectors].sort((a, c) => (c.chg1m ?? -999) - (a.chg1m ?? -999)).slice(0, 3).map((x) => `${sectorLabel(x.sector)} ${pct(x.chg1m, 1)}`).join("、")} が上位。`);
  }
  if (s.gainers.length) {
    lines.push(`値上がり上位: ${s.gainers.slice(0, 5).map((g) => `${shortNameOf(g.name, g.code)}(${g.code}) ${pct(g.chg1d)}`).join("、")}。`);
    lines.push(`値下がり上位: ${s.losers.slice(0, 5).map((g) => `${shortNameOf(g.name, g.code)}(${g.code}) ${pct(g.chg1d)}`).join("、")}。`);
  }
  const interesting = ["52W_HIGH", "BREAKOUT_20D", "GOLDEN_CROSS", "VOLUME_SPIKE", "RECLAIM_SMA200", "RSI_OVERSOLD", "52W_LOW", "DEAD_CROSS"];
  const sigLines = interesting.filter((k) => s.signalCounts[k]).map((k) => `${SIGNAL_LABELS[k]} ${s.signalCounts[k]} 銘柄（${s.signalExamples[k].slice(0, 4).join("、")}）`);
  if (sigLines.length) lines.push(`本日のシグナル: ${sigLines.join("；")}。`);
  return lines.join("\n");
}
