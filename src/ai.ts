// Workers AI commentary: a Japanese market brief and short notes on notable stocks.
import { unsupportedNumbers, dropUnsupported } from "./core/ai-guard";
import type { Env } from "./refresh";
import type { MarketSnapshot, ScreenerRow } from "./market";
import { SIGNAL_LABELS } from "./metrics";
import { shortNameOf, sectorLabel } from "./market";

export interface AiBinding { run(model: string, input: any): Promise<any> }

export const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
// Per-stock notes: Qwen3-30B-A3B used ~7 neurons per note against ~56 for Llama 3.3 in a side-by-side test
// (2026-10-15) with comparable Japanese; piloted on the crypto site first. The market brief stays on AI_MODEL.
export const NOTE_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";
const MAX_STOCK_NOTES = 8;

const pct = (v: number | null | undefined, d = 1) => (v == null ? "n/a" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
const short = shortNameOf;

async function chat(ai: AiBinding, system: string, user: string, maxTokens: number, model = AI_MODEL): Promise<string> {
  // Qwen3 thinks aloud unless told not to; a <think> block that still comes back is removed
  const qwen = model.includes("qwen3");
  const content = qwen ? `${user}\n銘柄名・社名は与えられた表記のまま書き、翻訳しないこと。\n/no_think` : user;
  // Up to two attempts; the one whose percentages all come from the prompt wins, and a sentence that still carries an invented
  // percentage / bp is dropped (src/core/ai-guard.ts).
  let best: { text: string; bad: number } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await ai.run(model, { messages: [{ role: "system", content: system }, { role: "user", content }], max_tokens: maxTokens, temperature: 0.3 });
    const raw = typeof r === "string" ? r : r?.response ?? r?.result?.response ?? r?.choices?.[0]?.message?.content ?? "";
    const text = String(raw).replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    const bad = unsupportedNumbers(text, user).length;
    if (!best || bad < best.bad) best = { text, bad };
    if (!bad) break;
  }
  return best!.bad ? dropUnsupported(best!.text, user) : best!.text;
}

// Per-stock notes (8 a day) on the lighter NOTE_MODEL, falling back to AI_MODEL on an error or a too-short reply.
async function chatNote(ai: AiBinding, system: string, user: string, maxTokens: number): Promise<string> {
  try { const t = await chat(ai, system, user, maxTokens, NOTE_MODEL); if (t.length >= 40) return t; } catch { /* fall back */ }
  return chat(ai, system, user, maxTokens);
}

const SYSTEM = `あなたはトルコ株式市場（Borsa Istanbul）を担当する経験豊富な日本語のマーケットアナリストです。
与えられた数値データだけに基づいて、簡潔で具体的な日本語のコメントを書きます。
ルール:
- データにない事実（ニュース、決算内容、マクロ要因の断定）を作らない。推測する場合は「〜の可能性」と明示する。
- 数値は与えられた値をそのまま使う。銘柄は「銘柄名(コード)」の形で書く。
- 売買の指示はしない。「注目」「確認したい点」という表現にとどめる。
- マークダウンの見出し記号や箇条書き記号は使わず、プレーンテキストで段落を分ける。
用語の注意:
- 「PER実績」は過去12ヶ月の利益に対する倍率、「PER予想」は来期の予想利益に対する倍率で、別々の指標。両者の差を「低下した/上昇した」のように時間的な推移として書かない。予想が実績より低ければ「増益が見込まれている」、高ければ「減益が見込まれている」と解釈する。
- PERが負の値は赤字（利益がマイナス）を意味し、「低い＝割安」ではない。
- 「52週安値比 +X%」は安値からの上昇幅、「52週高値比 -X%」は高値からの下落幅。
- RSIは70以上で買われすぎ、30以下で売られすぎの目安。
- 価格・時価総額は TRY（トルコ・リラ）建てで与えられる。トルコは高インフレ・通貨安が続くため、リラ建ての値上がりが実質的な価値の上昇を意味するとは限らず、円換算の騰落にも為替の影響が大きく含まれうる。データにない要因は断定しない。`;

export async function generateMarketCommentary(env: Env, snap: MarketSnapshot, rows: ScreenerRow[]): Promise<string | null> {
  if (!env.AI) return null;
  const i = snap.index, b = snap.breadth;
  const p = (x: number) => (b.n ? Math.round((x / b.n) * 100) : 0);
  const sectors = snap.sectors.map((s) => `${sectorLabel(s.sector)}: 1日${pct(s.chg1d)} 1週${pct(s.chg1w)} 1ヶ月${pct(s.chg1m)} 3ヶ月${pct(s.chg3m)} 200日線上${s.aboveSma200Pct ?? "n/a"}%`).join("\n");
  const sig = Object.entries(snap.signalCounts).filter(([k]) => !["UPTREND", "DOWNTREND"].includes(k)).sort((a, c) => c[1] - a[1])
    .map(([k, n]) => `${SIGNAL_LABELS[k] ?? k}: ${n}銘柄 (${(snap.signalExamples[k] ?? []).slice(0, 4).join("、")})`).join("\n");
  const byMom = rows.filter((r) => r.kind === "equity" && r.m.chg3m != null).sort((a, c) => c.m.chg3m! - a.m.chg3m!);
  const leaders = byMom.slice(0, 6).map((r) => `${short(r.name, r.code)}(${r.code}) 3ヶ月${pct(r.m.chg3m)} 1年${pct(r.m.chg12m)} RSI${r.m.rsi14?.toFixed(0) ?? "n/a"}`).join("、");
  const laggards = byMom.slice(-6).reverse().map((r) => `${short(r.name, r.code)}(${r.code}) 3ヶ月${pct(r.m.chg3m)} 52週高値比${pct(r.m.fromHi52)}`).join("、");
  const user = `日付: ${snap.date}
BIST100（BIST 100 指数）: ${i ? `${i.close.toFixed(2)} 前日比${pct(i.chg1d, 2)} 週${pct(i.chg1w)} 月${pct(i.chg1m)} 3ヶ月${pct(i.chg3m)} 年初来${pct(i.chgYtd)} 1年${pct(i.chg12m)} 52週高値比${pct(i.fromHi52)} RSI14 ${i.rsi14 ?? "n/a"} 50日線比${pct(i.vsSma50)} 200日線比${pct(i.vsSma200)}` : "n/a"}
ブレッドス(${b.n}銘柄): 上昇${b.advancers} 下落${b.decliners} 変わらず${b.unchanged} 中央値${pct(b.medianChg1d, 2)} 1ヶ月中央値${pct(b.medianChg1m)} 200日線上${p(b.aboveSma200)}% 50日線上${p(b.aboveSma50)}% 20日線上${p(b.aboveSma20)}% 上昇トレンド${b.uptrend} 下降トレンド${b.downtrend} 52週高値更新${b.newHi52} 52週安値更新${b.newLo52}
セクター:
${sectors}
値上がり上位: ${snap.gainers.slice(0, 5).map((g) => `${short(g.name, g.code)}(${g.code}) ${pct(g.chg1d, 2)}`).join("、")}
値下がり上位: ${snap.losers.slice(0, 5).map((g) => `${short(g.name, g.code)}(${g.code}) ${pct(g.chg1d, 2)}`).join("、")}
3ヶ月モメンタム上位: ${leaders}
3ヶ月モメンタム下位: ${laggards}
シグナル:
${sig}

上記データから、個人投資家向けの本日のマーケットコメントを日本語で書いてください。構成は次の3段落、合計400〜550字:
1. 市場全体の状況（指数の位置、ブレッドスから読み取れる地合い、セクターの強弱）
2. 注目に値する動き（シグナルやモメンタム上位・下位から2〜4銘柄を具体名で挙げ、数値を添えて理由を述べる）
3. 確認したい点・リスク（地合いの弱さや過熱、売られすぎの反発余地など、データから言えることだけ）`;
  const text = await chat(env.AI, SYSTEM, user, 900);
  return text || null;
}

export function pickNotableStocks(snap: MarketSnapshot, rows: ScreenerRow[], watchedSymbols: Set<string>): ScreenerRow[] {
  const prio = ["52W_HIGH", "BREAKOUT_20D", "GOLDEN_CROSS", "RECLAIM_SMA200", "VOLUME_SPIKE", "RSI_OVERSOLD", "52W_LOW", "BIG_UP_DAY", "BIG_DOWN_DAY"];
  const score = (r: ScreenerRow) => {
    let s = watchedSymbols.has(r.symbol) ? 100 : 0;
    for (const sg of r.m.signals) { const k = prio.indexOf(sg); if (k >= 0) s += prio.length - k; }
    s += Math.min(Math.abs(r.m.chg1d ?? 0), 10);
    return s;
  };
  return rows.filter((r) => r.kind === "equity" && r.m.date === snap.date && (r.m.signals.some((s) => prio.includes(s)) || watchedSymbols.has(r.symbol)))
    .sort((a, b) => score(b) - score(a)).slice(0, MAX_STOCK_NOTES);
}

function peLine(t?: number | null, fw?: number | null): string {
  const d = (v: number | null | undefined) => (v == null ? "n/a" : v < 0 ? `${v.toFixed(1)}（赤字）` : v.toFixed(1));
  let rel = "";
  if (t != null && fw != null && t > 0 && fw > 0) rel = fw < t ? "（予想のほうが低い＝来期は増益見込み）" : fw > t ? "（予想のほうが高い＝来期は減益見込み）" : "";
  else if (t != null && fw != null && t > 0 && fw < 0) rel = "（来期は赤字予想）";
  else if (t != null && fw != null && t < 0 && fw > 0) rel = "（来期は黒字転換予想）";
  return `PER実績（過去12ヶ月） ${d(t)}、PER予想（来期） ${d(fw)} ${rel}。※これは2つの別指標で、推移ではない`;
}

export async function generateStockNote(env: Env, r: ScreenerRow): Promise<string | null> {
  if (!env.AI) return null;
  const m = r.m, f = r.f ?? {};
  const user = `銘柄: ${short(r.name, r.code)}(${r.code}) セクター: ${sectorLabel(r.sector)} 日付: ${m.date}
終値 ${m.close} 1日${pct(m.chg1d, 2)} 1週${pct(m.chg1w)} 1ヶ月${pct(m.chg1m)} 3ヶ月${pct(m.chg3m)} 6ヶ月${pct(m.chg6m)} 1年${pct(m.chg12m)} 年初来${pct(m.chgYtd)}
SMA20比${pct(m.vsSma20)} SMA50比${pct(m.vsSma50)} SMA200比${pct(m.vsSma200)} RSI14 ${m.rsi14?.toFixed(0) ?? "n/a"} 52週高値比${pct(m.fromHi52)} 52週安値比${pct(m.fromLo52)} 出来高/20日平均 ${m.volRatio?.toFixed(2) ?? "n/a"}倍 20日ボラ(年率)${m.vol20?.toFixed(0) ?? "n/a"}% 1年最大DD${pct(m.mdd1y)}
${m.goldenCrossDays != null ? `ゴールデンクロス ${m.goldenCrossDays}日前 ` : ""}${m.deadCrossDays != null ? `デッドクロス ${m.deadCrossDays}日前 ` : ""}
シグナル: ${m.signals.map((s) => SIGNAL_LABELS[s] ?? s).join("、") || "なし"}
ファンダ: 時価総額 ${f.marketCap ? (f.marketCap / 1e9).toFixed(2) + "B " + (r.currency ?? "TRY") : "n/a"}（通貨 ${r.currency ?? "TRY"}）
${peLine(f.trailingPE, f.forwardPE)}
PBR ${f.priceToBook?.toFixed(2) ?? "n/a"}、配当利回り ${f.dividendYield != null ? f.dividendYield.toFixed(2) + "%" : "n/a"}

この銘柄について、テクニカルとファンダの数値から読み取れることを日本語で2〜3文（120〜180字）で述べてください。シグナルが出ている背景（トレンド・出来高・位置関係）と、次に確認したいポイントを含めます。`;
  const text = await chatNote(env.AI, SYSTEM, user, 320);
  return text || null;
}

// Generate commentary + stock notes; persists into market_daily and ai_notes. Returns summary.
export async function runAiCommentary(env: Env, snap: MarketSnapshot, rows: ScreenerRow[]): Promise<{ brief: boolean; notes: number; errors: string[] }> {
  const out = { brief: false, notes: 0, errors: [] as string[] };
  if (!env.AI) { out.errors.push("AI binding not configured"); return out; }
  const db = env.DB;
  try {
    const text = await generateMarketCommentary(env, snap, rows);
    if (text) {
      snap.aiBrief = text; snap.aiModel = AI_MODEL; snap.aiGeneratedAt = new Date().toISOString();
      out.brief = true;
    }
  } catch (e: any) { out.errors.push(`brief: ${e?.message ?? e}`); }

  const watched = new Set<string>((await db.prepare("SELECT DISTINCT symbol FROM user_watchlist").all<{ symbol: string }>()).results?.map((r) => r.symbol) ?? []);
  const picks = pickNotableStocks(snap, rows, watched);
  const now = new Date().toISOString();
  const notes: { code: string; name: string | null; text: string }[] = [];
  const results = await Promise.allSettled(picks.map((r) => generateStockNote(env, r)));
  const stmts: D1PreparedStatement[] = [];
  results.forEach((res, i) => {
    const r = picks[i];
    if (res.status === "fulfilled" && res.value) {
      notes.push({ code: r.code, name: r.name, text: res.value });
      stmts.push(db.prepare("INSERT OR REPLACE INTO ai_notes (symbol, date, text, model, created_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(r.symbol, snap.date, res.value, NOTE_MODEL, now));
    } else if (res.status === "rejected") out.errors.push(`${r.code}: ${res.reason?.message ?? res.reason}`);
  });
  if (stmts.length) await db.batch(stmts);
  snap.aiStocks = notes;
  out.notes = notes.length;
  await db.prepare("UPDATE market_daily SET json = ?1 WHERE date = ?2").bind(JSON.stringify(snap), snap.date).run();
  return out;
}
