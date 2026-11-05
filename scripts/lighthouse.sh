#!/usr/bin/env bash
# Lighthouse baseline against a LOCAL production build (there is no hosted
# deploy; see the roadmap's closing amendment). Not in CI: a score on a laptop
# is evidence to record, not a gate.
#
# Usage: npm run build:deploy, then npm run lighthouse
#
# Each page is warmed with one request first, so a drug outside the prerender
# set is measured after its first-visit upgrade (ADR-005 Q3): the steady state
# a second visitor gets, not the one-time cold render. Three runs per page and
# form factor; the summary reports the median. Raw reports go to
# .lighthouse/ (gitignored), the summary to stdout.
set -euo pipefail

cd "$(dirname "$0")/.."
PORT=3459
BASE="http://127.0.0.1:$PORT"
OUT=.lighthouse
RUNS=3
PAGES=("/" "/search?q=metformin" "/drug/860975" "/drug/617312")
LH="npx -y lighthouse@12.8.2"

rm -rf "$OUT" && mkdir -p "$OUT"
npx next start -p "$PORT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 60); do curl -sf -o /dev/null "$BASE" && break; sleep 0.5; done

for page in "${PAGES[@]}"; do curl -s -o /dev/null "$BASE$page"; done

for preset in mobile desktop; do
  flag=""; [ "$preset" = desktop ] && flag="--preset=desktop"
  for page in "${PAGES[@]}"; do
    slug=$(echo "$page" | tr -c 'a-zA-Z0-9\n' '_')
    for run in $(seq $RUNS); do
      $LH "$BASE$page" $flag --quiet --chrome-flags="--headless=new" \
        --only-categories=performance,accessibility,best-practices,seo \
        --output=json --output-path="$OUT/$preset$slug-$run.json" >/dev/null
    done
    echo "  $preset $page"
  done
done

node scripts/lighthouse-summary.mjs "$OUT"
