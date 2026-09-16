# Upstream fixtures

Real, unedited responses from RxNorm, openFDA, and NADAC, captured 2026-08-23
(`nadac/datasets.json` re-captured 2026-09-16 — see below).
They exist so that the quirks documented in [`docs/upstream-notes.md`](../../../docs/upstream-notes.md)
are testable rather than remembered, and they become the MSW handlers in W2.

Refresh deliberately, never automatically:

```sh
scripts/capture-upstream.sh
```

Two things here are counter-intuitive and are kept on purpose:

- `rxnorm/props-bogus.json` is `{}` and `rxnorm/search-nonsense.json` is a
  `null`-filled envelope — both served with HTTP 200. They are the "not found"
  cases (upstream-notes §1.1).
- `rxnorm/historystatus-404.json` is the plain text `Not found`, not JSON. It is
  the fixture that proves a client must not call `.json()` on an error response
  (§1.2).

- `nadac/datasets.json` was re-captured on 2026-09-16 because the 2026 dataset's
  *distribution* identifier rotates weekly (upstream-notes §3.1), and the
  captured one was superseded. The **dataset** identifiers are the point of this
  fixture and all 14 are unchanged since 2026-08-23, which is the stability
  ADR-009 pins the config to. Tests assert the selection *rule*, not either ID.

openFDA label responses are trimmed to the first 1–3 `results`; the untrimmed
sizes quoted in the notes (118 KB for one label) are what the API actually sends.
