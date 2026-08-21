import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import storybook from "eslint-plugin-storybook";
import boundaries from "eslint-plugin-boundaries";

/**
 * Module boundaries.
 *
 *   app       routes, layouts, route handlers      → features, ui, lib
 *   server    GraphQL BFF: schema, resolvers,      → lib
 *             upstream clients
 *   feature   slices: drug, search, compare        → ui, lib
 *   ui        design system primitives             → lib
 *   lib       types, formatters, tokens,           → nothing internal
 *             generated GraphQL
 *
 * Default is DENY. Anything not granted below is an error, so a new kind of
 * import fails loudly rather than being quietly permitted.
 *
 * Nothing imports `app`. `feature` and `server` never import each other —
 * they meet on the generated types in `lib/gql/` and nowhere else.
 *
 * Features are reachable only through their `index.ts` barrel. Deep paths
 * into a slice's internals are rejected, which is what makes the barrel a
 * real public API rather than a convention.
 *
 * Plugin version: eslint-plugin-boundaries 7.2.0. In v7 the older
 * `element-types`, `entry-point`, `no-private`, and `no-unknown` rules are all
 * deprecated in favour of the unified `boundaries/dependencies` rule, so that
 * is what this config uses. Entry-point enforcement is expressed through the
 * `fileInternalPath` selector rather than the deprecated `entry-point` rule.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...storybook.configs["flat/recommended"],

  {
    plugins: { boundaries },
    settings: {
      "boundaries/include": ["src/**/*"],
      "boundaries/elements": [
        { type: "app", pattern: "src/app" },
        { type: "server", pattern: "src/server" },
        { type: "feature", pattern: "src/features/*", capture: ["family"] },
        { type: "ui", pattern: "src/ui" },
        { type: "lib", pattern: "src/lib" },
      ],
    },
    rules: {
      // Any file under src/ that matches no element type above.
      "boundaries/no-unknown-files": "error",
      // Any import that resolves to something the plugin cannot classify.
      "boundaries/no-unknown-dependencies": "error",

      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          policies: [
            // ---- app -------------------------------------------------
            {
              from: { element: { type: "app" } },
              allow: { to: { element: { types: { anyOf: ["ui", "lib"] } } } },
            },
            {
              // Through the barrel only. A deep path into a slice is denied
              // by the default, because no policy grants it.
              from: { element: { type: "app" } },
              allow: {
                to: {
                  element: { type: "feature", fileInternalPath: "index.ts" },
                },
              },
              message:
                "Import a feature through its index.ts barrel, not from its internals.",
            },

            // ---- server ----------------------------------------------
            {
              from: { element: { type: "server" } },
              allow: { to: { element: { type: "lib" } } },
            },

            // ---- feature ---------------------------------------------
            {
              from: { element: { type: "feature" } },
              allow: { to: { element: { types: { anyOf: ["ui", "lib"] } } } },
            },
            {
              // A slice may reach into itself. `{{from.family}}` pins it to
              // its own directory, so sibling slices stay unreachable.
              from: { element: { type: "feature" } },
              allow: {
                to: {
                  element: {
                    type: "feature",
                    captured: { family: "{{from.family}}" },
                  },
                },
              },
            },

            // ---- ui --------------------------------------------------
            {
              from: { element: { type: "ui" } },
              allow: { to: { element: { type: "lib" } } },
            },

            // ---- lib -------------------------------------------------
            // Imports nothing internal. Same-element imports within lib are
            // not cross-element dependencies and are unaffected.
          ],
        },
      ],
    },
  },

  {
    // Stories and tests document or exercise the thing they sit next to, and
    // deliberately reach past the public surface to do it.
    files: ["**/*.stories.@(ts|tsx)", "**/*.test.@(ts|tsx)"],
    rules: { "boundaries/dependencies": "off" },
  },

  {
    // Raw palette values are surfaced only in src/lib/tokens.css (ui-spec §13).
    files: ["src/**/*.@(ts|tsx)"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/#[0-9a-fA-F]{3,8}\\b/]",
          message:
            "Raw hex colors are not allowed outside src/lib/tokens.css. Use a semantic token.",
        },
      ],
    },
  },

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "storybook-static/**",
    "coverage/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
