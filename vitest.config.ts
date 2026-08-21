import path from "node:path";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const dirname = import.meta.dirname;

const alias = { "@": path.join(dirname, "src") };

export default defineConfig({
  test: {
    projects: [
      {
        // Plain unit tests: pure functions and component behaviour that does
        // not need a real browser. Fast, runs on every commit.
        resolve: { alias },
        plugins: [react()],
        test: {
          name: "unit",
          environment: "jsdom",
          globals: true,
          setupFiles: [path.join(dirname, "vitest.setup.ts")],
          include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.ts"],
          testTimeout: 30_000,
        },
      },
      {
        // Storybook stories run as tests in a real Chromium — this is what
        // makes the a11y addon's checks meaningful.
        extends: true,
        resolve: { alias },
        // `aria-query` is CJS; without pre-bundling, Vite serves it raw and the
        // named exports Storybook's a11y layer imports are not detectable.
        // Several of Testing Library's transitive deps are CJS. Without
        // pre-bundling, Vite serves them raw and their named/default exports
        // are not detectable from the browser bundle.
        optimizeDeps: {
          include: [
            "@testing-library/dom",
            "aria-query",
            "lz-string",
            "dom-accessibility-api",
            "pretty-format",
          ],
        },
        plugins: [
          storybookTest({ configDir: path.join(dirname, ".storybook") }),
        ],
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
