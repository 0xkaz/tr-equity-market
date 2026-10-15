// GENERATED from 0xkaz/equity-hub core/check-crons.mjs (core 2026.10.05). Do not edit here: edit equity-hub/core and run scripts/sync-core.mjs.
// Fails when wrangler.jsonc uses numeric day-of-week values in cron triggers.
// Cloudflare numbers weekdays 1=Sunday..7=Saturday (not 0=Sunday), so "1-5" means Sunday–Thursday.
// Use names instead: MON-FRI, SUN-THU, ... Run from the site root (scripts/deploy.sh calls it).
import { readFileSync } from "node:fs";

const raw = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
// strip // and /* */ comments outside strings, then trailing commas
const noComments = raw.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str ?? "");
const cfg = JSON.parse(noComments.replace(/,(\s*[}\]])/g, "$1"));
const crons = cfg?.triggers?.crons ?? [];
const bad = crons.filter((c) => {
  const f = String(c).trim().split(/\s+/);
  return f.length >= 5 && /\d/.test(f[4]);
});
if (bad.length) {
  console.error(`check-crons: numeric day-of-week in ${JSON.stringify(bad)}.`);
  console.error("Cloudflare uses 1=Sunday..7=Saturday, so use names such as MON-FRI or SUN-THU.");
  process.exit(1);
}
console.log(`check-crons: ok (${crons.length} schedule${crons.length === 1 ? "" : "s"})`);
