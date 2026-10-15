#!/usr/bin/env bash
# Deploy the Worker with wrangler.
# In the Claude cloud environment the Cloudflare API token is injected by the
# egress proxy (Authorization header is overwritten for api.cloudflare.com), so
# wrangler only needs *some* value in CLOUDFLARE_API_TOKEN to pick the token
# auth path. Locally, set CLOUDFLARE_API_TOKEN to a real token instead.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/check-crons.mjs
node scripts/check-sync.mjs  # refuse to deploy if origin/main has commits this checkout lacks
# the Yahoo chart code must keep the partial-bar / empty-close guards (behavioural check: equity-hub scripts/check-site-yahoo.mjs)
grep -q parseDailyBars src/yahoo.ts && grep -q sessionOpen src/core/chart-bars.ts || { echo "src/yahoo.ts does not use the shared chart parser (src/core/chart-bars.ts); refusing to deploy" >&2; exit 1; }
export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-proxy-injected}"
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-124300268e36bf09488a7764257eb0d2}"
node scripts/embed-static.mjs
npx wrangler d1 migrations apply tr-equity --remote
# Optional: ADMIN_EMAILS / ALLOWED_EMAILS (comma separated) are passed as plain vars when set.
EXTRA=()
[ -n "${ADMIN_EMAILS:-}" ] && EXTRA+=(--var "ADMIN_EMAILS:${ADMIN_EMAILS}")
[ -n "${ALLOWED_EMAILS:-}" ] && EXTRA+=(--var "ALLOWED_EMAILS:${ALLOWED_EMAILS}")
npx wrangler deploy "${EXTRA[@]}" "$@"
