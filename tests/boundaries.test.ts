import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/**
 * The boundary config is only worth having if it actually rejects things.
 * Rather than proving that once in a throwaway branch, prove it on every CI
 * run: lint synthetic importers against each edge of the layer graph.
 *
 * The *importing* file is virtual — `lintText` takes a path that need not
 * exist — but every *imported* module here is real. An unresolvable import is
 * invisible to the plugin, which would make these assertions pass vacuously.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const eslint = new ESLint({ cwd: root });

async function lint(relativePath: string, source: string) {
  const [result] = await eslint.lintText(source, {
    filePath: path.join(root, relativePath),
  });
  return (result?.messages ?? []).filter((m) =>
    m.ruleId?.startsWith("boundaries/"),
  );
}

const imports = {
  featureBarrel: `import { formatPerUnit } from "@/features/drug";\nexport const x = formatPerUnit;\n`,
  featureDeep: `import type { DrugSummary } from "@/features/drug/types";\nexport type X = DrugSummary;\n`,
  ui: `import { Button } from "@/ui/Button";\nexport const x = Button;\n`,
  lib: `import { cn } from "@/lib/cn";\nexport const x = cn;\n`,
  server: `import { typeDefs } from "@/server/schema";\nexport const x = typeDefs;\n`,
  app: `import Home from "@/app/page";\nexport const x = Home;\n`,
};

describe("module boundaries", () => {
  describe("rejects", () => {
    it("ui importing a feature", async () => {
      expect(await lint("src/ui/Bad.ts", imports.featureBarrel)).not.toHaveLength(0);
    });

    it("ui importing server", async () => {
      expect(await lint("src/ui/Bad.ts", imports.server)).not.toHaveLength(0);
    });

    it("lib importing ui", async () => {
      expect(await lint("src/lib/bad.ts", imports.ui)).not.toHaveLength(0);
    });

    it("lib importing a feature", async () => {
      expect(await lint("src/lib/bad.ts", imports.featureBarrel)).not.toHaveLength(0);
    });

    it("server importing ui", async () => {
      expect(await lint("src/server/bad.ts", imports.ui)).not.toHaveLength(0);
    });

    it("server importing a feature", async () => {
      expect(await lint("src/server/bad.ts", imports.featureBarrel)).not.toHaveLength(0);
    });

    it("a feature importing server", async () => {
      expect(await lint("src/features/compare/bad.ts", imports.server)).not.toHaveLength(0);
    });

    it("one feature importing another through its barrel", async () => {
      expect(await lint("src/features/compare/bad.ts", imports.featureBarrel)).not.toHaveLength(0);
    });

    it("one feature importing another's internals via a deep path", async () => {
      expect(await lint("src/features/compare/bad.ts", imports.featureDeep)).not.toHaveLength(0);
    });

    it("app importing a feature's internals via a deep path", async () => {
      expect(await lint("src/app/bad.ts", imports.featureDeep)).not.toHaveLength(0);
    });

    it("anything importing app", async () => {
      expect(await lint("src/features/drug/bad.ts", imports.app)).not.toHaveLength(0);
    });
  });

  describe("allows", () => {
    it("app importing a feature barrel, ui, and lib", async () => {
      expect(
        await lint(
          "src/app/ok.ts",
          imports.featureBarrel + imports.ui.replace("x", "y") + imports.lib.replace("x", "z"),
        ),
      ).toHaveLength(0);
    });

    it("a feature importing ui and lib", async () => {
      expect(
        await lint("src/features/drug/ok.ts", imports.ui + imports.lib.replace("x", "y")),
      ).toHaveLength(0);
    });

    it("a feature importing its own internals", async () => {
      expect(await lint("src/features/drug/ok.ts", imports.featureDeep)).toHaveLength(0);
    });

    it("ui importing lib", async () => {
      expect(await lint("src/ui/Ok.ts", imports.lib)).toHaveLength(0);
    });

    it("server importing lib", async () => {
      expect(await lint("src/server/ok.ts", imports.lib)).toHaveLength(0);
    });

    // ADR-003. The BFF is mounted from a route handler, so `app` has to be
    // able to reach the schema and resolvers.
    it("app importing server", async () => {
      expect(await lint("src/app/api/graphql/route.ts", imports.server)).toHaveLength(0);
    });
  });
});
