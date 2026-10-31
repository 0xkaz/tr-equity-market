// Crawlable stock pages (/stock/<code>) and the sitemap. The dashboard routes with #/…, which search engines treat as
// the top page, so every stock shared the one indexable URL. /stock/<code> serves the same app shell with the stock's
// own title, description, canonical URL and structured data (and a short summary until the app draws); the app reads
// the path as its first route (public/app.js route()).

export interface SeoStock { code: string; name: string | null; sector: string | null; kind: string; currency?: string | null; date: string | null; close: number | null; metrics?: string | null }

// The stock's latest computed figures (metrics.json) in words, for the description and the summary. Facts only, no view.
interface Figures { chg1d?: number; chg1m?: number; chg3m?: number; chgYtd?: number; hi52?: number; lo52?: number; fromHi52?: number; fromLo52?: number; vsSma200?: number; rsi14?: number; signals?: string[] }
const pct = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`;
const num = (x: number) => x.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
function figuresOf(t: SeoStock): Figures | null {
  if (!t.metrics) return null;
  try { return JSON.parse(t.metrics) as Figures; } catch { return null; }
}
/** "1か月 +5.1%・3か月 +2.1%、52週高値から -23.3%" (the parts that exist) */
function shortFigures(f: Figures | null): string {
  if (!f) return "";
  const moves = [isNum(f.chg1m) ? `1か月 ${pct(f.chg1m)}` : "", isNum(f.chg3m) ? `3か月 ${pct(f.chg3m)}` : ""].filter(Boolean).join("・");
  return [moves, isNum(f.fromHi52) ? `52週高値から ${pct(f.fromHi52)}` : ""].filter(Boolean).join("、");
}
/** Sentences for the page summary: moves, the 52-week range, the 200-day average, RSI and current signals. */
export function summarySentences(t: SeoStock, signalLabels: Record<string, string> = {}): string[] {
  const f = figuresOf(t);
  if (!f) return [];
  const unit = t.kind === "index" ? "" : ` ${t.currency || DEFAULT_CURRENCY}`;
  const out: string[] = [];
  const moves = [isNum(f.chg1d) ? `前日比 ${pct(f.chg1d)}` : "", isNum(f.chg1m) ? `1か月 ${pct(f.chg1m)}` : "", isNum(f.chg3m) ? `3か月 ${pct(f.chg3m)}` : "", isNum(f.chgYtd) ? `年初来 ${pct(f.chgYtd)}` : ""].filter(Boolean);
  if (moves.length) out.push(`騰落率は${moves.join("、")}。`);
  if (isNum(f.hi52) && isNum(f.lo52) && isNum(f.fromHi52) && isNum(f.fromLo52)) out.push(`52週の高値は ${num(f.hi52)}${unit}（そこから ${pct(f.fromHi52)}）、安値は ${num(f.lo52)}${unit}（そこから ${pct(f.fromLo52)}）。`);
  const tech = [isNum(f.vsSma200) ? `200日移動平均比 ${pct(f.vsSma200)}` : "", isNum(f.rsi14) ? `RSI(14) は ${f.rsi14.toFixed(0)}` : ""].filter(Boolean);
  if (tech.length) out.push(`${tech.join("、")}。`);
  const sig = (f.signals ?? []).map((s) => signalLabels[s] ?? s).filter(Boolean);
  if (sig.length) out.push(`点灯中のシグナル: ${sig.join("、")}。`);
  return out;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
// exchange codes such as SAP, 0700, AZZA3, BRK-B, SCA-B, M&M, PE&OLES (no slashes; looked up as given)
export const isStockCode = (code: string) => /^[0-9A-Za-z][0-9A-Za-z.&-]{0,15}$/.test(code);
// the site's exchange prefix for JSON-LD tickerSymbol (empty: left out) and the price currency when the row has none
const TICKER_PREFIX = "IST";
const DEFAULT_CURRENCY = "TRY";

export function stockMeta(t: SeoStock, sectorJa: Record<string, string>, site: string) {
  const name = t.name || t.code;
  const what = t.kind === "index" ? "指数" : "株価";
  const title = `${name}（${t.code}）${what}・チャート・指標 | ${site}`;
  const sector = t.sector ? sectorJa[t.sector] ?? t.sector : null;
  const figs = shortFigures(figuresOf(t));
  const price = t.close != null && t.date ? `終値 ${t.close.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}${t.kind === "index" ? "" : ` ${t.currency || DEFAULT_CURRENCY}`}（${t.date}）${figs ? `、${figs}` : ""}。` : "";
  const description = `${name}（${t.code}${sector ? `・${sector}` : ""}）の${what}チャート、テクニカル指標、シグナル。${price}`;
  return { title, description };
}

/** The app shell (index.html) with the stock's head tags and a short summary in place of the loading line. */
export function stockPage(shell: string, origin: string, t: SeoStock, sectorJa: Record<string, string>, site: string, signalLabels: Record<string, string> = {}): string {
  const { title, description } = stockMeta(t, sectorJa, site);
  const url = `${origin}/stock/${encodeURIComponent(t.code)}`;
  const ld = {
    "@context": "https://schema.org", "@type": "WebPage", name: title, url, description, inLanguage: "ja",
    ...(t.kind === "index" ? {} : { about: { "@type": "Corporation", name: t.name || t.code, ...(TICKER_PREFIX ? { tickerSymbol: `${TICKER_PREFIX}:${t.code}` } : {}) } }),
  };
  const head = [
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:type" content="website">`, `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`, `<meta property="og:url" content="${esc(url)}">`,
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`,
  ].join("\n  ");
  const facts = summarySentences(t, signalLabels);
  const summary = `<h1>${esc(t.name || t.code)}（${esc(t.code)}）</h1><p>${esc(description)}</p>${facts.length ? `<p>${esc(facts.join(""))}</p><p class="muted">数値は${esc(t.date ?? "直近")}時点の参考情報で、投資の判断を勧めるものではありません。</p>` : ""}<p class="muted">読み込み中…</p>`;
  return shell
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(description)}">`)
    .replace("</head>", `  ${head}\n</head>`)
    .replace(/<main id="app">[\s\S]*?<\/main>/, `<main id="app">${summary}</main>`);
}

/** sitemap.xml: the top page and every active stock page. */
export function sitemapXml(origin: string, rows: Array<{ code: string; last_price_date: string | null }>): string {
  const url = (loc: string, lastmod?: string | null) => `<url><loc>${esc(loc)}</loc>${lastmod ? `<lastmod>${esc(lastmod)}</lastmod>` : ""}</url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + [url(`${origin}/`), url(`${origin}/stocks`), ...rows.map((r) => url(`${origin}/stock/${encodeURIComponent(r.code)}`, r.last_price_date))].join("\n")
    + `\n</urlset>\n`;
}

/**
 * /stocks: every active stock as a plain link to its /stock/<code> page, by sector. The app's own links are #/…, so
 * without this page a crawler that starts at the top page never reaches the stock pages (the sitemap aside).
 * A standalone page, not the app shell: the app would replace the list with its overview.
 */
export function stockIndexPage(origin: string, site: string, rows: Array<{ code: string; name: string | null; sector: string | null }>, sectorJa: Record<string, string>): string {
  const groups = new Map<string, typeof rows>();
  for (const r of rows) { const k = r.sector ? sectorJa[r.sector] ?? r.sector : "その他"; (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
  const sections = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "ja")).map(([sector, list]) =>
    `<section><h2>${esc(sector)}（${list.length}）</h2><ul>${list.map((r) => `<li><a href="/stock/${encodeURIComponent(r.code)}">${esc(r.code)} ${esc(r.name || "")}</a></li>`).join("")}</ul></section>`).join("\n");
  const title = `銘柄一覧（${rows.length} 銘柄）| ${site}`;
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(`${site} が扱う ${rows.length} 銘柄の一覧（業種別）。各銘柄の株価チャート・テクニカル指標へのリンク。`)}">
  <link rel="canonical" href="${esc(origin)}/stocks">
  <link rel="stylesheet" href="/style.css">
  <style>main{max-width:1100px;margin:0 auto;padding:16px}ul{columns:3 16em;padding-left:1.2em}li{break-inside:avoid;margin:2px 0}h2{font-size:16px;margin-top:20px}</style>
</head>
<body>
  <main>
    <p><a href="/">← ${esc(site)}（ダッシュボード）</a></p>
    <h1>銘柄一覧</h1>
    ${sections}
  </main>
</body>
</html>
`;
}
