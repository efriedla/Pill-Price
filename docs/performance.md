# BFF performance — measured

The W2 definition of done asks for **p95 BFF response for a cached drug under
200 ms**, measured and recorded. This is the record.

ADR-007 (W6) owns budgets and their enforcement in CI. This document is the
W2 measurement it will build on, not that decision.

## Result

**p95 = 34 ms against a 200 ms budget**, for a cached drug.

| | cold (first request for an RxCUI) | **cached** |
| --- | --- | --- |
| n | 18 distinct RxCUIs | 100 requests |
| min | 189 ms | 11 ms |
| p50 | 226 ms | **16 ms** |
| p90 | — | 28 ms |
| p95 | 567 ms | **34 ms** |
| p99 | — | 50 ms |
| max | 567 ms | 113 ms |

Measured 2026-09-11 against `npm run build && npm run start` on the author's
machine — a production build, not `next dev`. Localhost, so the client-side of
the number is free and the figures are the **server's** cost, which is what the
budget is about. Live upstreams, real NADAC snapshot (4.1 MB, 2026-08-26).

## The query

Not a trivial one — it walks every layer the page needs:

```graphql
query D($r: ID!) {
  drug(rxcui: $r) {
    rxcui name tty isGeneric
    price { pricePerUnit effectiveDate asOf }   # NADAC snapshot, local
    alternatives(kind: ALL) { ... }             # RxNorm allrelated
    label { __typename }                        # openFDA
  }
}
```

So each request touches RxNorm three times (properties, ndcs, allrelated),
openFDA once, and the local price index once.

## What the two columns mean

**The cold column is the honest one to worry about, and it is not the budget.**
226 ms at p50 is a live fan-out: RxNorm ×3 plus openFDA, and it is bounded by
openFDA, exactly as ADR-011 measured (~700 ms p50 for the fan-out in isolation;
this is faster because the three RxNorm calls run concurrently and concurrency
is free on both sources).

**This is the clearest confirmation of ADR-011's central claim:** no timeout
value could have brought the cold path under 200 ms, because the cold path is
dominated by upstreams answering *successfully*. The budget was always the
cache's to meet. Cold is 6.7× the cached p50 and 17× the cached p95.

**What the cached column is not.** It is not "GraphQL is fast." It is the
`use cache` layer in `src/server/cached.ts` (one week, per ADR-010, matching
ADR-009's price TTL so the page has one freshness story) plus the price index,
which is parsed once per process rather than once per request — 4 MB of JSON and
a 32,500-entry Map would blow the whole budget on its own if built per request.

## Caveats, stated rather than buried

- **One machine, one afternoon, localhost.** Per ADR-009's correction, treat
  every figure as a floor. A deployed environment adds network, cold lambdas and
  a shared cache that this does not measure.
- **`priceHistory` is not in the query, because it is not implemented.** It needs
  the ~102 MB of history the snapshot does not hold — the retention decision
  ADR-009 flags as one the sync job will force.
- **`label` resolves to a `__typename` only**, because Q2 is deferred: openFDA
  returns up to 91 SPLs from 55 labelers for one drug and which of them `Label`
  names is unanswered. The openFDA *request* is made and cached, so its cost is
  in the number; only the field selection is missing.
- **The snapshot used was 16 days old** (`asOf` 2026-08-26 against a 2026-09-11
  run), past ADR-009's 14-day staleness threshold. That does not affect latency,
  but the UI notice ADR-009 specifies would have been firing. **Resolved the
  same day:** the job was re-run and the snapshot is now 1,088,173 rows /
  32,621 priced NDCs, `complete: true`, `asOf` 2026-09-11. The figures above
  were taken against the older snapshot; its size (4.1 MB) and shape are
  effectively unchanged (3.95 MB), so they stand.

## How to re-measure

```sh
npm run build && npm run start
# then, against http://localhost:3000/api/graphql, POST the query above:
#   3 warm-up requests, then 100 timed ones for the cached column
#   1 request each across ~18 distinct RxCUIs for the cold column
```
