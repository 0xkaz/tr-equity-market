// Tell IndexNow engines (Bing, Yandex, Naver, Seznam; not Google) about every URL in the live sitemap.
// Run after a deploy that adds or renames pages:  node scripts/indexnow.mjs [--dry-run]
// The key is the name of public/<32 hex>.txt (served at /<key>.txt, which IndexNow fetches to verify the host).
import { readdirSync } from "node:fs";
const HOST = "tr-equity.0xkaz.com";
const key = readdirSync(new URL("../public/", import.meta.url)).find((f) => /^[0-9a-f]{32}\.txt$/.test(f))?.slice(0, -4);
if (!key) { console.error("no public/<key>.txt"); process.exit(2); }
const xml = await (await fetch(`https://${HOST}/sitemap.xml`)).text();
const urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
console.log(`${urlList.length} URLs from the sitemap`);
if (process.argv.includes("--dry-run")) process.exit(0);
const r = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key, keyLocation: `https://${HOST}/${key}.txt`, urlList }),
});
console.log(`IndexNow: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
process.exit(r.ok ? 0 : 1);
