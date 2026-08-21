import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The boundaries rule is only worth having if it actually rejects things.
 * Rather than proving that once in a throwaway commit, prove it on every CI
 * run: lint synthetic importers against each edge of the layer graph.
 *
 * The *importing* file is virtual (`lintText` takes a path that need not
 * exist), but the *imported* file must be real — an unresolvable import is
 * invisible to the plugin, which would make every assertion here pass
 * vacuously. Hence the fixture module written in `beforeAll`.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const eslint = new ESLint({ cwd: root });

const fixtureFeature = path.join(root, "src/features/__fixture__");

beforeAll(async () => {
  await mkdir(fixtureFeature, { recursive: true });
  await writeFile(
    path.join(fixtureFeature, "target.ts"),
    "export const target = true;\n",
  );
});

afterAll(async () => {
  await rm(path.join(root, "src/features"), { recursive: true, force: true });
});

async function lint(relativePath: string, source: string) {
  const [result] = await eslint.lintText(source, {
    filePath: path.join(root, relativePath),
  });
  return result?.messages ?? [];
}

const boundaryErrors = (messages: Awaited<ReturnType<typeof lint>>) =>
  messages.filter((m) => m.ruleId?.startsWith("boundaries/"));

const FEATURE_IMPORT = `import { target } from "@/features/__fixture__/target";\nexport const x = target;\n`;

describe("module boundaries (ADR-003)", () => {
  it("rejects ui importing a feature", async () => {
    expect(
      boundaryErrors(await lint("src/components/ui/Bad.tsx", FEATURE_IMPORT)),
    ).not.toHaveLength(0);
  });

  it("rejects lib importing a feature", async () => {
    expect(
      boundaryErrors(await lint("src/lib/bad.ts", FEATURE_IMPORT)),
    ).not.toHaveLength(0);
  });

  it("rejects lib importing ui", async () => {
    expect(
      boundaryErrors(
        await lint(
          "src/lib/bad.ts",
          `import { Button } from "@/components/ui/Button";\nexport const x = Button;\n`,
        ),
      ),
    ).not.toHaveLength(0);
  });

  it("rejects one feature importing another", async () => {
    expect(
      boundaryErrors(
        await lint("src/features/compare/bad.ts", FEATURE_IMPORT),
      ),
    ).not.toHaveLength(0);
  });

  it("allows a feature importing itself", async () => {
    expect(
      boundaryErrors(
        await lint("src/features/__fixture__/ok.ts", FEATURE_IMPORT),
      ),
    ).toHaveLength(0);
  });

  it("allows app importing a feature, ui, and lib", async () => {
    expect(
      boundaryErrors(
        await lint(
          "src/app/ok.ts",
          `import { target } from "@/features/__fixture__/target";\nimport { Button } from "@/components/ui/Button";\nimport { cn } from "@/lib/cn";\nexport const x = [target, Button, cn];\n`,
        ),
      ),
    ).toHaveLength(0);
  });

  it("allows ui importing lib", async () => {
    expect(
      boundaryErrors(
        await lint(
          "src/components/ui/Ok.ts",
          `import { cn } from "@/lib/cn";\nexport const x = cn;\n`,
        ),
      ),
    ).toHaveLength(0);
  });
});
