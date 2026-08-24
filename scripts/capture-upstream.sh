#!/usr/bin/env bash
# Re-capture the upstream fixtures used by docs/upstream-notes.md and (from W2) MSW.
#
# These are real responses from live public APIs, committed deliberately: the
# point of the fixtures is that they preserve upstream's actual quirks, so they
# are refreshed on purpose, never on every run.
#
# Usage: scripts/capture-upstream.sh
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=tests/fixtures/upstream
RXCUI=${RXCUI:-860975}   # metformin ER 500 MG, SCD

mkdir -p "$OUT"/{rxnorm,openfda,nadac}

get() { # name url
  printf '%-28s' "$1"
  curl -sS -m 60 -w ' [%{http_code} %{time_total}s %{size_download}B]\n' -o "$2" "$3"
}

echo "== RxNorm"
R=https://rxnav.nlm.nih.gov/REST
get search-metformin        "$OUT/rxnorm/search-metformin.json"        "$R/drugs.json?name=metformin"
get search-nonsense         "$OUT/rxnorm/search-nonsense.json"         "$R/drugs.json?name=zzzqqq"
get search-typo-metfromin   "$OUT/rxnorm/search-typo-metfromin.json"   "$R/drugs.json?name=metfromin"
get approx-metfromin        "$OUT/rxnorm/approx-metfromin.json"        "$R/approximateTerm.json?term=metfromin&maxEntries=10"
get "props-$RXCUI"          "$OUT/rxnorm/props-$RXCUI.json"            "$R/rxcui/$RXCUI/properties.json"
get props-bogus             "$OUT/rxnorm/props-bogus.json"             "$R/rxcui/99999999/properties.json"
get "related-$RXCUI"        "$OUT/rxnorm/related-$RXCUI.json"          "$R/rxcui/$RXCUI/related.json?tty=IN+PIN+SCDC+SCD+SBD"
get "allrelated-$RXCUI"     "$OUT/rxnorm/allrelated-$RXCUI.json"       "$R/rxcui/$RXCUI/allrelated.json"
get "ndcs-$RXCUI"           "$OUT/rxnorm/ndcs-$RXCUI.json"             "$R/rxcui/$RXCUI/ndcs.json"
# 404 with a plain-text body — see upstream-notes §1.2. Kept as a fixture on purpose.
get historystatus-404       "$OUT/rxnorm/historystatus-404.json"       "$R/rxcuistatus.json?rxcui=$RXCUI"

echo "== openFDA"
F=https://api.fda.gov/drug
get "label-rxcui-$RXCUI"    "$OUT/openfda/label-rxcui-$RXCUI.json"     "$F/label.json?search=openfda.rxcui:%22$RXCUI%22&limit=1"
get label-rxcui-none        "$OUT/openfda/label-rxcui-none.json"       "$F/label.json?search=openfda.rxcui:%2299999999%22&limit=1"
get label-bad-query         "$OUT/openfda/label-bad-query.json"        "$F/label.json?search=nonsense_field:%22x%22&limit=1"
get label-count-rxcui       "$OUT/openfda/label-count-rxcui.json"      "$F/label.json?search=openfda.rxcui:%22$RXCUI%22&count=openfda.manufacturer_name.exact"
get "ndc-rxcui"             "$OUT/openfda/ndc-rxcui.json"              "$F/ndc.json?search=openfda.rxcui:%22$RXCUI%22&limit=5"
get label-batch-or          "$OUT/openfda/label-batch-or.json"         "$F/label.json?search=openfda.rxcui:(%22$RXCUI%22+OR+%22617314%22+OR+%22197361%22)&limit=10"

echo "== NADAC"
python3 - "$OUT" "$RXCUI" <<'PY'
import json, re, sys, time, urllib.request

out, rxcui = sys.argv[1], sys.argv[2]
META = "https://data.medicaid.gov/api/1/metastore/schemas/dataset/items?show-reference-ids=false"


def fetch(url, body=None):
    req = urllib.request.Request(url)
    if body is not None:
        req.data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    t = time.time()
    d = json.load(urllib.request.urlopen(req, timeout=180))
    return d, time.time() - t


# The dataset UUID rotates every calendar year — see upstream-notes §3.1.
index, dt = fetch(META)
# Titles are literally "NADAC (National Average Drug Acquisition Cost) <year>".
# Matching on "NADAC" alone also catches "NADAC Comparison" (3.4M rows, a
# different shape) and sorts it above every yearly file — see upstream-notes §3.1.
YEARLY = re.compile(r"^NADAC \(National Average Drug Acquisition Cost\) (\d{4})$")
nadac = [x for x in index if YEARLY.match(x.get("title", ""))]
print(f"{'metastore index':<28} [{len(index)} datasets, {len(nadac)} NADAC, {dt:.2f}s]")
json.dump(nadac, open(f"{out}/nadac/datasets.json", "w"), indent=1)

current = max(nadac, key=lambda x: YEARLY.match(x["title"]).group(1))
dist = current["distribution"][0]["identifier"]
print(f"{'current dataset':<28} {current['title']} -> {dist}")
Q = f"https://data.medicaid.gov/api/1/datastore/query/{dist}"

d, dt = fetch(f"{Q}?limit=1")
print(f"{'schema probe':<28} [{d['count']} rows, {dt:.2f}s]")
json.dump(d, open(f"{out}/nadac/schema.json", "w"), indent=1)

# GET with hundreds of `in` values exceeds the URL limit and 400s; POST does not.
ndcs = json.load(open(f"{out}/rxnorm/ndcs-{rxcui}.json"))["ndcGroup"]["ndcList"]["ndc"]
d, dt = fetch(Q, {"conditions": [{"property": "ndc", "operator": "in", "value": ndcs}],
                  "limit": 500, "schema": False})
matched = {r["ndc"] for r in d["results"]}
print(f"{'ndcs-for-'+rxcui:<28} [{len(ndcs)} NDCs in, {len(matched)} matched, "
      f"count={d['count']}, {dt:.2f}s]")
json.dump(d, open(f"{out}/nadac/ndcs-for-{rxcui}.json", "w"), indent=1)

d, dt = fetch(Q, {"conditions": [{"property": "ndc", "operator": "=", "value": "99999999999"}],
                  "limit": 5, "schema": False})
print(f"{'ndc-missing':<28} [count={d['count']}, {dt:.2f}s  <- a miss costs as much as a hit]")
json.dump(d, open(f"{out}/nadac/ndc-missing.json", "w"), indent=1)
PY

echo "== trimming oversized fixtures"
python3 - "$OUT" <<'PY'
import json, sys, pathlib
out = sys.argv[1]
# openFDA labels run to ~118KB each; keep enough results to show the shape.
for p, n in [("openfda/label-rxcui-*.json", 1), ("openfda/label-batch-or.json", 3),
             ("openfda/ndc-rxcui.json", 3)]:
    for f in pathlib.Path(out).glob(p):
        d = json.loads(f.read_text())
        if isinstance(d, dict) and isinstance(d.get("results"), list):
            d["results"] = d["results"][:n]
            f.write_text(json.dumps(d, indent=1))
PY

du -sh "$OUT"/*
