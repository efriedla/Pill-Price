# Contributing

This is a small app with a large amount of deliberate structure. Most of the
rules below exist because of a decision recorded in `docs/adr/`, and the fastest
way to understand a constraint is to read the ADR that created it.

Read `docs/ui-spec.md` before writing UI. It is not a style guide — it decides
what may be displayed at all.

---

## The one rule that matters

**NADAC reports what pharmacies pay to acquire a drug.** It is not a consumer
price, not a copay, and not an insurance rate. The whole project rests on being
honest about that, so:

- Every price figure carries its unit and its date: `$0.0412 per unit · as of Aug 12, 2026`
- Every displayed value traces to a real API field. If it isn't in the field
  mapping in `docs/ui-spec.md` §1, it does not ship. Do not compute a plausible
  number to fill a gap in a layout
- Alternatives are described factually — *"Shares an active ingredient with X"*
  — never *"people also take"*, never as a recommendation
- Say "drug class," not "what it treats." Say "marketing start," not "approved"

If a design needs a value the data can't support, the design changes.

---

## Setup

```bash
npm ci
npm run dev          # http://localhost:3000
npm run storybook    # http://localhost:6006
```

Node 24. `npm ci`, not `npm install`, unless you are deliberately changing the
lockfile.

---

## Before you open a PR

All five must pass. They are the same five checks CI runs, as five independent
required jobs.

```bash
npm run lint
npm run typecheck
npm run codegen:check
npm test
npm run build
```

`codegen:check` fails if `src/lib/gql/types.generated.ts` no longer matches the
SDL in `src/server/schema.ts`. If it fails, run `npm run codegen` and commit the
result — never hand-edit the generated file.

`npm test` runs two projects: `unit` (jsdom, fast) and `storybook` (stories
executed in real Chromium, which is what makes the a11y checks meaningful).
While iterating, `npm run test:unit` skips the browser.

---

## Architecture

### Module boundaries

Imports travel one way, and never sideways between slices:

```
app  →  feature  →  ui  →  lib
server  ─────────────────→  lib
```

| Layer | Path | Alias | May import | Holds |
| --- | --- | --- | --- | --- |
| `app` | `src/app/` | `@/app/*` | feature, ui, lib | Routes, layouts, route handlers |
| `server` | `src/server/` | `@/server/*` | lib | GraphQL BFF: schema, resolvers, upstream clients |
| `feature` | `src/features/<name>/` | `@/features/*` | ui, lib | A vertical slice with its own data fetching and state |
| `ui` | `src/ui/` | `@/ui/*` | lib | Presentational primitives. No domain knowledge |
| `lib` | `src/lib/` | `@/lib/*` | nothing internal | Types, formatters, tokens, generated GraphQL |

**Default is deny.** Anything not in that table is an error, so a new kind of
import fails loudly instead of being quietly permitted.

**Nothing imports `app`.** It is the top of the graph.

**`feature` and `server` never import each other.** They meet on the generated
types in `src/lib/gql/` and nowhere else.

**Features are reachable only through their `index.ts` barrel.** A deep path
into a slice's internals is a lint error, which is what makes the barrel a real
public API rather than a convention. When you add something to a slice, decide
deliberately whether it goes in the barrel.

**Every module under `src/server/` starts with `import "server-only"`**, so a
BFF module pulled into a client bundle fails the build rather than leaking
upstream URLs or credentials into the browser.

Enforced by `eslint-plugin-boundaries` (v7, the unified
`boundaries/dependencies` rule), and asserted by `tests/boundaries.test.ts`,
which lints a synthetic violation of each edge and fails if the config does
*not* reject it. Changing the layer graph means changing that test — the
boundary should be hard to weaken quietly.

**When two features need the same thing,** it goes down into `lib` (logic) or
`ui` (presentation). It does not get imported across. If that feels like
overkill for the first shared helper, it isn't — the rule is what keeps
"independently led a complex feature end to end" a true sentence.

### Where things live

Stories, tests, and components sit together:

```
src/ui/Button.tsx
src/ui/Button.stories.tsx
src/lib/cn.ts
src/lib/cn.test.ts
```

No parallel `__tests__` tree, no `stories/` directory.

---

## Styling

**Semantic tokens only.** `src/lib/tokens.css` is the single file permitted
to contain raw palette values. Everywhere else, use a semantic token — an
ESLint rule rejects hex literals in `src/` and will fail your build.

Only semantic tokens are bridged into Tailwind, so `bg-surface-raised` and
`text-text-secondary` exist while `text-cinnamon` deliberately does not. That
isn't an oversight — see the contrast rules at the bottom of `tokens.css`:

- **Cinnamon and deep cyan are not text-safe.** Graphics, chart series, and
  large display type only. `--accent` (space blue) does all interactive work
- **Chart series use the `--chart-series-1..4` ramp**, ordered by lightness so
  the series separate in greyscale and under every form of colour vision
- **Light blue and lavender are surfaces**, never text and never interactive
- **Crimson is for warnings, recalls, and errors.** Never for price. Never in
  the same component as cinnamon

**Price direction is never encoded in colour** (`docs/ui-spec.md` §2). Green-up
/ red-down means gain/loss in finance; on drug prices the polarity is inverted
and either mapping misleads. Direction is carried by an arrow glyph *and* a text
label: `↓ 12% since Jan 2025`.

**Colour is never the only signal.** Every colour-coded category also carries a
text label. Boxed warnings combine crimson, a 3px left rule, an icon, and a bold
label — remove any one and the signal must still survive.

Typefaces are currently placeholders pending `docs/ui-spec.md` §10. Don't
hardcode a font stack; when the faces are chosen, `--font-display`,
`--font-body`, and `--font-numeric` get repointed and nothing else changes.

---

## Components

- **Every async surface has three states**: loading, empty, and error. Not two.
  Each gets a story
- **Accessibility is a prop, not an afterthought.** `Input` requires a `label`
  because there is no correct unlabelled variant. Follow that pattern — make the
  accessible version the only version rather than the default
- **Components don't assume document outline.** `Card` takes a `headingLevel`
  because the page owns its heading structure
- **Disclosure controls are real `<button>`s** with `aria-expanded`, expanding
  in place with no layout jump. Not links, not divs
- Prefer server components. Reach for `"use client"` when the component needs
  state, effects, or a hook like `useId` — and keep that boundary as low in the
  tree as it will go
- Variants are lookup tables (`Record<Variant, string>`), not string
  concatenation. If a component grows past a handful, that's a signal it's doing
  two jobs

Every component gets a Storybook story with controls, and the a11y addon must be
clean before the PR opens.

---

## Charts and data display

Some of these are easy to get wrong months from now, so they're written down:

- **Never interpolate across a gap.** Drugs enter and leave NADAC; a missing
  period is real information. Break the line
- **Sparse series (< 4 points) are not charts.** Render a labelled point set
- **Every chart needs a table equivalent** — keyboard-navigable, or a visually
  hidden `<table>`. This is the most likely a11y failure in the project. Build
  it with the chart, not in W7
- Ranges are `3M · 6M · 1Y · 5Y · ALL`. There is no daily or intraday data to
  put behind anything shorter
- Price columns use the `.tabular` class so figures align in `/compare`

---

## Pull requests

**Every change is a PR.** Nothing is committed to `main`.

### ADR before code

No feature starts until the decision doc exists. Copy `docs/adr/000-template.md`,
number it sequentially, and **link it from the PR body** — the template has a
required field for it. An ADR needs at least two options that were genuinely
considered; an option you never entertained doesn't count.

Config and chores are exempt. "I'll write the ADR after" is not.

### Commits

Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `ci:`, `refactor:`,
`test:`. The body explains *why*, not what — the diff already says what.

### Review

Request changes at least once before merging. A PR that sails through
unremarked is either trivial or unread.

### The explain-back gate

Write the PR description from memory, with the diff closed. If you can't account
for why a file changed, revert it and redo that part by hand. This is the
difference between a repo that exists and a repo you can defend.

---

## Dependencies

Dependabot opens grouped PRs weekly, batched by toolchain. Majors are ignored
deliberately — a major upgrade is a decision with an ADR, not a Monday morning
merge.

Before adding a dependency, ask what it costs at the boundary: does it push
work to the client, does it own data you'd rather own, and would writing the
20 lines yourself be clearer. `src/lib/cn.ts` is the house example of choosing
20 lines.

---

## Out of scope

Do not build these, regardless of how good the idea feels in week five:

auth · user accounts · a database · a monorepo · a mobile app · an admin panel ·
an interaction checker · i18n

A finished, polished small app beats a sprawling half-finished one. If you are
tempted, write the idea down in the roadmap's retro section instead.
