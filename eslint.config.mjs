import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import storybook from "eslint-plugin-storybook";
import boundaries from "eslint-plugin-boundaries";

/**
 * Module boundaries — ADR-003.
 *
 * Four layers, strictly one-directional:
 *
 *   app      routes and layouts. Composes features and ui.
 *   feature  a vertical slice (search, compare, drug-detail). Owns its own
 *            data fetching and state. Never imports another feature.
 *   ui       presentational primitives. Knows nothing about the domain.
 *   lib      pure helpers, clients, schemas. Imports nothing but lib.
 *
 * The rule that earns its keep is `feature -> feature`: without it, two slices
 * quietly grow a shared dependency and the "independently led a complex
 * feature" story stops being true.
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
        { type: "feature", pattern: "src/features/*", capture: ["family"] },
        { type: "ui", pattern: "src/components" },
        { type: "lib", pattern: "src/lib" },
      ],
    },
    rules: {
      "boundaries/no-unknown-dependencies": "error",
      "boundaries/no-unknown-files": "error",
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          policies: [
            {
              from: { element: { type: "app" } },
              allow: {
                to: { element: { types: { anyOf: ["feature", "ui", "lib"] } } },
              },
            },
            {
              // A feature may reach into itself, but never into a sibling.
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
            {
              from: { element: { type: "feature" } },
              allow: { to: { element: { types: { anyOf: ["ui", "lib"] } } } },
            },
            {
              from: { element: { type: "ui" } },
              allow: { to: { element: { types: { anyOf: ["ui", "lib"] } } } },
            },
            {
              from: { element: { type: "lib" } },
              allow: { to: { element: { type: "lib" } } },
            },
          ],
        },
      ],
    },
  },

  {
    // Stories are allowed to reach anywhere — they document the thing they sit
    // next to, and the boundary rules would otherwise flag every import.
    files: ["**/*.stories.@(ts|tsx)", "**/*.test.@(ts|tsx)"],
    rules: { "boundaries/dependencies": "off" },
  },

  {
    // Raw palette tokens are surfaced only in tokens.css (ui-spec §13).
    files: ["src/**/*.@(ts|tsx)"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/#[0-9a-fA-F]{3,8}\\b/]",
          message:
            "Raw hex colors are not allowed outside src/styles/tokens.css. Use a semantic token.",
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
