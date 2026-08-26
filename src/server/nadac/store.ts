import "server-only";

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { Snapshot } from "./snapshot";

/**
 * Where the snapshot lives.
 *
 * **ADR-009 chose the snapshot; it did not choose the storage engine.** That is
 * still open, and this interface is the seam that keeps it open: a JSON file is
 * enough for the ~3 MB latest-price table and needs no new infrastructure, but
 * `priceHistory` wants ~102 MB of history and will very likely force something
 * indexed. Whatever answers that question implements `SnapshotStore` and
 * nothing above this file changes.
 *
 * Deliberately not chosen here, because guessing would prejudge that decision
 * the way ADR-004 was careful not to prejudge the data path.
 */
export interface SnapshotStore {
  write(snapshot: Snapshot): Promise<void>;
  read(): Promise<Snapshot | null>;
}

export const DEFAULT_SNAPSHOT_PATH = path.join(
  process.cwd(),
  ".data/nadac-snapshot.json",
);

/**
 * A single-file JSON store.
 *
 * The write is atomic — a temp file plus a rename — because a torn snapshot is
 * worse than a stale one: a half-written price table reads as "these drugs have
 * no published price," which is exactly the sentence this app is trying to make
 * trustworthy.
 */
export function createFileSnapshotStore(
  filePath: string = DEFAULT_SNAPSHOT_PATH,
): SnapshotStore {
  return {
    async write(snapshot) {
      await mkdir(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.tmp`;
      await writeFile(temp, JSON.stringify(snapshot), "utf8");
      const { rename } = await import("node:fs/promises");
      await rename(temp, filePath);
    },

    async read() {
      try {
        return JSON.parse(await readFile(filePath, "utf8")) as Snapshot;
      } catch (error) {
        // A missing snapshot is a legitimate cold start, not an error. Anything
        // else — unreadable, corrupt JSON — must surface rather than silently
        // degrade into "no drug has a price."
        if (
          error instanceof Error &&
          (error as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          return null;
        }
        throw error;
      }
    },
  };
}
