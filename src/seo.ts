// Crawlable stock pages (/stock/<code>) and the sitemap. The dashboard routes with #/…, which search engines treat as
// the top page, so every stock shared the one indexable URL. /stock/<code> serves the same app shell with the stock's
// own title, description, canonical URL and structured data (and a short summary until the app draws); the app reads
// the path as its first route (public/app.js route()).

export interface SeoStock { code: string; name: string | null; sector: string | null; kind: string; currency?: string | null; date: string | null; close: number | null }

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
// exchange codes such as SAP, 0700, AZZA3, BRK-B, SCA-B (no slashes; looked up as given)
export const isStockCode = (code: string) => /^[0-9A-Za-z][0-9A-Za-z.-]{0,15}$/.test(code);
// the site's exchange prefix for JSON-LD tickerSymbol (empty: left out) and the price currency when the row has none
const TICKER_PREFIX = "IST";
const DEFAULT_CURRENCY = "TRY";

export function stockMeta(t: SeoStock, sectorJa: Record<string, string>, site: string) {
  const name = t.name || t.code;
  const what = t.kind === "index" ? "指数" : "株価";
  const title = `${name}（${t.code}）${what}・チャート・指標 | ${site}`;
  const sector = t.sector ? sectorJa[t.sector] ?? t.sector : null;
  const price = t.close != null && t.date ? `終値 ${t.close.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}${t.kind === "index" ? "" : ` ${t.currency || DEFAULT_CURRENCY}`}（${t.date}）。` : "";
  const description = `${name}（${t.code}${sector ? `・${sector}` : ""}）の${what}チャート、テクニカル指標、シグナル。${price}`;
  return { title, description };
}

/** The app shell (index.html) with the stock's head tags and a short summary in place of the loading line. */
export function stockPage(shell: string, origin: string, t: SeoStock, sectorJa: Record<string, string>, site: string): string {
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
  const summary = `<h1>${esc(t.name || t.code)}（${esc(t.code)}）</h1><p>${esc(description)}</p><p class="muted">読み込み中…</p>`;
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
