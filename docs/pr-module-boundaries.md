# PR: Enforce five-layer module boundaries

**Branch:** `feat/module-boundaries` → `main`
**Authorizing ADR:** ADR-003 — *pending, authored separately.* This PR
deliberately contains no ADR.

> Scratch file. Paste into the PR body and delete from the repo once the PR
> exists — there is no git remote configured, so the PR could not be opened
> from here.

---

## What

Restructures `src/` into the five layers and makes the import graph a build
failure rather than a convention.

```
app      routes, layouts, route handlers   → features, ui, lib
server   GraphQL BFF                       → lib
feature  slices: drug, search, compare     → ui, lib
ui       design system primitives          → lib
lib      types, formatters, tokens, gql    → nothing internal
```

Default is deny. Nothing imports `app`. `feature` and `server` never import
each other — they meet on the generated types in `lib/gql/` and nowhere else.
Features are reachable only through their `index.ts` barrel.

## How

- `src/components/ui/*` → `src/ui/*`; `src/styles/tokens.css` → `src/lib/tokens.css`
- Per-layer TS path aliases: `@/app/*`, `@/server/*`, `@/features/*`, `@/ui/*`, `@/lib/*`
- Three feature slices scaffolded, each with an `index.ts` barrel carrying a
  one-line comment naming it the slice's public API
- Every module under `src/server/` opens with `import "server-only"`
- `tests/boundaries.test.ts` grown from 7 assertions to 16

## Plugin version and rule choice

`eslint-plugin-boundaries@7.2.0`.

In v7 the rules I would have reached for are all deprecated — `element-types`,
`entry-point`, `no-private`, and `no-unknown` each emit a deprecation notice
pointing at the unified `boundaries/dependencies` rule. So this config uses:

| Rule | Why |
| --- | --- |
| `boundaries/dependencies` | The v7 unified rule. Carries the whole policy table, including entry-point enforcement via the `fileInternalPath` selector. |
| `boundaries/no-unknown-files` | Flags any file under `src/` matching no element type. Not deprecated. |
| `boundaries/no-unknown-dependencies` | Flags imports the plugin cannot classify. This is the v7 name; `no-unknown` is its deprecated alias. |

**Entry-point enforcement did not need a separate rule.** Because the default
is deny, a deep path into a slice is rejected simply by not being granted. The
`app → feature` policy is narrowed with
`to: { element: { type: "feature", fileInternalPath: "index.ts" } }`, so the
barrel is allowed and everything past it is not.

## Proof

Four deliberate violations on a throwaway branch, now deleted. Actual output:

```
/src/ui/ViolationA.ts
  1:31  error  There is no policy allowing dependencies from elements of type
               "ui" to elements of type "feature" and captured values:
               family="drug"                          boundaries/dependencies

/src/features/compare/ViolationB.ts
  1:34  error  There is no policy allowing dependencies from elements of type
               "feature" and captured values: family="compare" to elements of
               type "feature" and captured values: family="drug"
                                                      boundaries/dependencies

/src/server/ViolationC.ts
  1:24  error  There is no policy allowing dependencies from elements of type
               "server" to elements of type "ui"      boundaries/dependencies

/src/lib/ViolationD.ts
  1:22  error  There is no policy allowing dependencies from elements of type
               "lib" to elements of type "ui"         boundaries/dependencies

✖ 4 problems (4 errors, 0 warnings)
exit=1
```

Two extra probes, because violation (b) proves *cross-slice* rejection but not
that the **barrel itself** works:

```
app → "@/features/drug"        (barrel)     exit=0   ✓ allowed
app → "@/features/drug/types"  (deep path)  exit=1   ✓ rejected
   1:34  error  There is no policy allowing dependencies from elements of type
                "app" to elements of type "feature" and captured values:
                family="drug"                        boundaries/dependencies
```

And `no-unknown-files`:

```
src/misc/stray.ts
  1:1  error  File does not match any file pattern and does not belong to any
              known element                    boundaries/no-unknown-files
```

All violations deleted before commit. `lint`, `typecheck`, `test` (38), and
`build` all pass on the branch.

## Judgment calls the spec did not dictate

Listed so you can overrule any of them.

1. **`app` cannot import `server` — and I left it that way.** The spec grants
   `app → features, ui, lib` and says everything unlisted is forbidden, so I
   implemented it literally. **This will block the BFF route handler in W2**: a
   GraphQL Yoga handler at `app/api/graphql/route.ts` has to import the schema
   and resolvers from `server/`, and today that is an error. Either `app` gains
   `→ server`, or `server` is mounted some other way. I did not silently add
   the edge, because it is a real architectural decision and ADR-003 is yours.
   **This is the one item I would resolve before merge.**

2. **A slice may import its own internals.** Not stated either way. Without an
   explicit same-family policy, `formatPerUnit.ts` importing `./types` inside
   the same slice would have been denied and the barrel pattern would be
   unusable. Granted via `captured: { family: "{{from.family}}" }`, which pins
   it to the slice's own directory so siblings stay unreachable.

3. **`ui → ui` and `lib → lib` are not granted, and do not need to be.** Each
   is a single element, so intra-layer imports are not cross-element
   dependencies and the rule never fires. `Button.tsx` importing `Card.tsx`
   works. If `ui/` is ever split into sub-elements this becomes a real decision.

4. **`src/styles/tokens.css` moved to `src/lib/tokens.css`.** "Do not add
   folders beyond the five layers" made `src/styles/` a sixth folder, and the
   spec lists tokens under `lib`. Knock-on edits: the `@import` in
   `globals.css`, the three sketch `<link>`s, the CODEOWNERS path, and the
   no-raw-hex lint message.

5. **The generic `@/*` alias was removed** rather than kept alongside the five.
   Keeping it would let anyone bypass the per-layer aliases and made every
   layer look like one namespace — the illusion the boundaries exist to remove.

6. **Stories and tests are exempt** from `boundaries/dependencies`. They
   document or exercise the thing they sit next to and reach past the public
   surface deliberately. `no-unknown-files` still applies to them.

7. **Feature slices got real content, not empty barrels.** Each has a `types.ts`
   and one small pure function (`formatPerUnit`, `parseSearchParams`,
   `parseCompareParams`). An empty barrel exports nothing, so the deep-import
   rule would have had nothing to bite on and the proof above would be
   vacuous. All three are W3/W4 placeholders and expected to be rewritten.

8. **`server/` is flat** — `schema.ts`, `resolvers.ts`, and three `*-client.ts`
   files rather than a `clients/` subfolder, reading "do not add folders beyond
   the five layers" strictly.

9. **`server-only` added as a dependency.** Required for `import "server-only"`
   to resolve; it is the standard Next mechanism.

10. **`docs/adr/README.md` is now stale** — it still describes the old
    four-layer graph. I did not touch it, since it is ADR material and you are
    writing ADR-003. `CONTRIBUTING.md` and `README.md` *were* updated, as
    neither is an ADR.

## Verification

- [x] `npm run lint` · `npm run typecheck` · `npm test` · `npm run build` pass
- [x] Four required violations each rejected, output pasted above
- [x] Barrel allowed, deep path rejected
- [x] Unclassified file rejected
- [x] Violations deleted before commit
- [x] No raw hex outside `src/lib/tokens.css`
- [ ] `lint` already required in CI — no workflow change needed

## Explain-back

`src/` now has exactly five directories because the lint config can only
enforce a graph whose nodes are directories. The barrel matters more than the
layer list: `feature → feature` was already denied, but without entry-point
narrowing, `app` could still reach into a slice's internals and couple to its
private shape. Narrowing the `app → feature` grant to `index.ts` is what makes
the barrel load-bearing. The `server-only` imports are a second, independent
guard — lint catches the wrong import at author time, `server-only` catches it
at build time if the lint rule is ever loosened.
