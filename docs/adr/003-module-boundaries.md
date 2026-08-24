# ADR-003: Module boundaries

**Status:** accepted
**Date:** 2026-08-23

## Context

The roadmap's W4 claim is "independently led a complex feature end to end."
That sentence stops being true the moment `compare` and `drug` grow a shared
dependency, because then neither was led end to end — they were led together.
The boundary that protects the claim is `feature ⇸ feature`, and it is worth
almost nothing as a convention: cross-slice imports are added one at a time,
each individually reasonable, and no reviewer rejects the first one.

There is a second, sharper reason. This app puts a GraphQL BFF in the same
Next.js process as the UI, and `src/server/` holds upstream API clients that
will eventually carry keys and rate-limit state. In a single-process App Router
app, nothing about the file system stops a client component from importing a
resolver; the failure surfaces as a bundle leak, and bundle leaks are found by
reading build output, which nobody does on a Tuesday.

So the graph needs to be a build failure. The scaffold provisionally implemented
five layers with `eslint-plugin-boundaries@7.2.0`:

```
app      routes, layouts, route handlers   → features, ui, lib
server   GraphQL BFF                       → lib
feature  slices: drug, search, compare     → ui, lib
ui       design system primitives          → lib
lib      types, formatters, tokens, gql    → nothing internal
```

Default deny: anything not granted is an error, so a new *kind* of import fails
loudly rather than being quietly permitted.

**The open question this ADR exists to close.** The original spec granted
`app → features, ui, lib` and said everything unlisted was forbidden. That was
implemented literally, which means `app` cannot import `server` — and a GraphQL
Yoga handler at `app/api/graphql/route.ts` has to import the schema and
resolvers to mount them. W2 is blocked on day one by a lint rule. Either the
edge is added or the BFF is mounted differently, and that is an architecture
call rather than a config tweak.

## Options considered

### Option A — Grant `app → server`

- **For:** a route handler mounting the BFF is exactly what `app` is for. The
  layer's job is composition — it already composes features and ui, and
  composing a server-side module is the same act. The boundary that carries the
  actual weight is `feature ⇸ server`, and that stays intact: no UI slice can
  reach a resolver or an upstream client, which is the leak the graph exists to
  prevent. One line of config, no new infrastructure, no explaining.
- **Against:** the grant is coarser than the need. It permits a page component
  to import `server/nadac-client` directly, not just the route handler. The
  second guard catches that at build time rather than author time.

### Option B — Grant `app → server`, narrowed to route handlers

Same edge, restricted to files matching `src/app/api/**`.

- **For:** precisely the access the BFF needs and nothing more. A page component
  importing an upstream client stays a lint error.
- **Against:** buys a narrow slice of protection that `server-only` already
  covers, and pays for it with a rule that has to be explained every time
  someone hits it. It also encodes a route-directory naming convention into the
  lint config, so moving the handler becomes a config change. The extra
  precision is real but small; the extra explanation is real and recurring.

### Option C — Mount the BFF outside `app`

Run the GraphQL server as a standalone process, or have `server/` own the route
so `app` never imports it.

- **For:** preserves the literal spec. Makes the BFF independently deployable
  and independently scalable.
- **Against:** adds real infrastructure in W2, the week that already carries the
  most interview weight and the most genuine difficulty. A second process means
  a second deploy target, a network hop that did not need to exist, CORS, and
  local-dev orchestration — all in service of a boundary whose purpose is
  already met by `feature ⇸ server`. The roadmap's scope lock is explicit that
  W2's depth belongs in DataLoader batching, retries, degradation, and caching.
  Spending it on process topology is the wrong trade.

### Option D — Drop the boundaries plugin; enforce by review

- **For:** no config to maintain, no rule to explain.
- **Against:** this is the option that fails silently and looks fine doing it.
  It also deletes the artifact — a lint config and a test suite that prove the
  graph holds is evidence; a stated intention is not.

## Decision

**Keep the five-layer graph with default-deny, and grant `app → server`.**

The full policy:

```
app      →  feature (via index.ts only), ui, lib, server
server   →  lib
feature  →  ui, lib, own slice
ui       →  lib
lib      →  nothing internal
```

Nothing imports `app`. `feature` and `server` never import each other — they
meet on the generated types in `lib/gql/` and nowhere else. Features are
reachable only through their `index.ts` barrel; a deep path into a slice's
internals is denied by the default, because no policy grants it.

The coarseness of the `app → server` grant is accepted rather than overlooked,
and it is covered by a second, independent mechanism: **every module under
`src/server/` opens with `import "server-only"`**. Lint catches the wrong import
at author time; `server-only` fails the build if a client component reaches a
server module even after a lint rule is loosened or an override is added. Two
mechanisms with different failure modes is worth more here than one narrower
rule, because the thing being prevented — an API key in a client bundle — is the
kind of mistake that must not depend on a single point of enforcement.

**The graph is asserted, not just configured.** `tests/boundaries.test.ts` lints
synthetic importers against each edge on every CI run and fails if a violation
is *not* rejected. A config that silently stops working — a plugin major, a
settings key renamed, an `overrides` block added in the wrong place — is
otherwise indistinguishable from a config that works, since both produce a green
lint run. The importing file in each assertion is virtual, but every imported
module is real: an unresolvable import is invisible to the plugin, and the
assertion would pass vacuously.

### Choices this ADR also ratifies

The scaffold made several calls the original spec did not dictate. Each is
adopted here so they are decided rather than inherited.

1. **A slice may import its own internals**, via
   `captured: { family: "{{from.family}}" }`. Without it, a file importing
   `./types` from inside its own slice would be denied and the barrel pattern
   would be unusable. The capture pins the grant to the slice's own directory,
   so siblings stay unreachable.
2. **`ui → ui` and `lib → lib` are not granted and do not need to be.** Each is
   a single element, so intra-layer imports are not cross-element dependencies
   and the rule never fires. If `ui/` is ever split into sub-elements this
   becomes a real decision.
3. **The generic `@/*` path alias was removed** in favour of the five per-layer
   aliases. Keeping it alongside them would let any import bypass the layer
   names and make `src/` read as one namespace — the exact illusion the
   boundaries exist to remove.
4. **Stories and tests are exempt** from `boundaries/dependencies`. They
   document or exercise the thing they sit beside and reach past the public
   surface deliberately. `boundaries/no-unknown-files` still applies to them.
5. **`src/` holds exactly five directories.** `src/styles/tokens.css` moved to
   `src/lib/tokens.css` rather than becoming a sixth. The lint config can only
   enforce a graph whose nodes are directories, so a directory outside the graph
   is a directory outside enforcement — `boundaries/no-unknown-files` makes that
   an error instead of a gap.
6. **`server/` is flat** — `schema.ts`, `resolvers.ts`, and three `*-client.ts`
   files rather than a `clients/` subfolder. Same reasoning as (5), read
   strictly. Revisit when the file count makes it genuinely hard to scan.

### Rule selection

`eslint-plugin-boundaries@7.2.0`. In v7 the rules one would reach for from
memory — `element-types`, `entry-point`, `no-private`, `no-unknown` — are all
deprecated in favour of the unified `boundaries/dependencies` rule, so that is
what carries the policy table. Entry-point enforcement needed no separate rule:
because the default is deny, narrowing the `app → feature` grant with
`fileInternalPath: "index.ts"` allows the barrel and rejects everything past it.
`boundaries/no-unknown-files` and `boundaries/no-unknown-dependencies` are
additionally enabled so that a file matching no element, or an import the plugin
cannot classify, is an error rather than a blind spot.

## Consequences

**Easier.** W2 is unblocked — the BFF mounts as a normal route handler with no
new infrastructure. The W4 compare feature can be described as independently
built, and the claim is checkable rather than asserted. Onboarding is a diagram
and one sentence about the barrel.

**Harder.** Shared logic between two slices now has to go somewhere deliberate —
down into `lib` if it is pure, or into `ui` if it is presentational. There will
be a moment in W4 when duplicating twenty lines is the correct answer and it
will feel wrong. Every new feature slice needs a barrel that is maintained as a
real public API rather than a re-export dump.

**Committed to.** The five directories, and to `server-only` as the second
guard. Also committed to keeping `tests/boundaries.test.ts` honest: an edge
added to the config without a matching assertion is an edge nobody is checking.

**Accepted risk.** A page component *can* import an upstream client. Nothing in
the current codebase does, and `server-only` turns any attempt into a build
failure the moment that component is a client component. If it ever happens in a
server component — where `server-only` is satisfied and the import is legal —
the cost is a layering smell rather than a leak.

## Revisit if

- A page component is found importing `src/server/` directly. That is the signal
  Option B was right, and narrowing the grant to `src/app/api/**` is then a
  two-line change.
- `ui/` grows enough to warrant sub-elements, which makes `ui → ui` a real
  policy question for the first time.
- A third consumer of the GraphQL schema appears — a second app, a worker, a
  public endpoint. At that point Option C's separate process stops being
  overhead and starts being the design.
- `tests/boundaries.test.ts` has to be weakened to make a legitimate change
  pass. That means the graph and the code have diverged, and one of them is
  wrong.
