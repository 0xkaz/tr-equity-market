// GENERATED from 0xkaz/equity-hub core/check-sync.mjs (core 2026.10.06-2). Do not edit here: edit equity-hub/core and run scripts/sync-core.mjs.
// Refuses to deploy when this checkout is missing commits that are on origin/main.
// Several people / sessions work on the same sites; deploying from a stale checkout silently
// removes their changes from production. Run from the site root (scripts/deploy.sh calls it).
//
//   ALLOW_STALE_DEPLOY=1 npm run deploy   # override (e.g. emergency rollback on purpose)
import { execSync } from "node:child_process";

const sh = (cmd) => execSync(cmd, { cwd: new URL("..", import.meta.url).pathname, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

if (process.env.ALLOW_STALE_DEPLOY === "1") {
  console.warn("check-sync: skipped (ALLOW_STALE_DEPLOY=1)");
  process.exit(0);
}
try { sh("git rev-parse --git-dir"); } catch {
  console.warn("check-sync: not a git checkout, skipped");
  process.exit(0);
}
try {
  sh("git fetch --quiet --depth=100 origin main");
} catch (e) {
  console.warn(`check-sync: could not fetch origin/main (${String(e.message).split("\n")[0]}); continuing without the check`);
  process.exit(0);
}
let missing = 0;
try { missing = Number(sh("git rev-list --count HEAD..FETCH_HEAD")); } catch { missing = -1; }
if (missing === 0) {
  const dirty = sh("git status --porcelain --untracked-files=no");
  console.log(`check-sync: ok (up to date with origin/main${dirty ? ", with uncommitted local changes" : ""})`);
  process.exit(0);
}
const log = missing > 0 ? sh("git log --oneline -10 HEAD..FETCH_HEAD") : "(could not compare histories)";
console.error(`check-sync: origin/main has ${missing > 0 ? missing : "unknown"} commit(s) that this checkout does not include:`);
console.error(log.split("\n").map((l) => "  " + l).join("\n"));
console.error("Deploying now would remove them from production. Merge first:  git fetch origin main && git merge FETCH_HEAD");
console.error("(Override with ALLOW_STALE_DEPLOY=1 only if you mean to roll back.)");
process.exit(1);
