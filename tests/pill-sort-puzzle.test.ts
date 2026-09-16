import { describe, expect, it } from "vitest";

import {
  canMove,
  isLevelSolvable,
  isWin,
  makeLevel,
  type Bottle,
} from "@/ui/PillSortLoader";

/**
 * The puzzle makes one promise to the player that it could quietly break: every
 * board it offers can actually be finished. A wait is already an imposition; an
 * impossible puzzle during one is worse than no puzzle, and "start over" would
 * not rescue it because the board is regenerated, not repaired.
 */

describe("every generated level is solvable", () => {
  it("holds across levels and repeated generation", () => {
    for (let level = 1; level <= 4; level++) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const board = makeLevel(level);
        expect(isLevelSolvable(board)).toBe(true);
      }
    }
  });

  it("never hands the player a board that is already finished", () => {
    // A pre-sorted board is solvable, but it is not a puzzle — it reads as the
    // game being broken.
    for (let attempt = 0; attempt < 12; attempt++) {
      expect(isWin(makeLevel(2))).toBe(false);
    }
  });

  it("always has at least two free bottles to work with", () => {
    const board = makeLevel(3);
    expect(board.filter((b) => b.length === 0).length).toBeGreaterThanOrEqual(2);
  });

  it("grows with the level", () => {
    expect(makeLevel(3).length).toBeGreaterThan(makeLevel(1).length);
  });
});

describe("move rules", () => {
  const pill = (id: number, t: number) => ({ id, t });

  it("allows a pill onto an empty bottle or a matching top", () => {
    const bs: Bottle[] = [[pill(1, 0)], [], [pill(2, 0)], [pill(3, 1)]];
    expect(canMove(bs, 0, 1)).toBe(true); // onto empty
    expect(canMove(bs, 0, 2)).toBe(true); // onto same kind
    expect(canMove(bs, 0, 3)).toBe(false); // onto a different kind
  });

  it("refuses to move out of a finished bottle, or into a full one", () => {
    const done: Bottle = [pill(1, 0), pill(2, 0), pill(3, 0), pill(4, 0)];
    const full: Bottle = [pill(5, 1), pill(6, 1), pill(7, 1), pill(8, 2)];
    const bs: Bottle[] = [done, full, [pill(9, 2)]];

    expect(canMove(bs, 0, 2)).toBe(false); // sorted bottles stay sorted
    expect(canMove(bs, 2, 1)).toBe(false); // full is full
  });

  it("refuses a move onto itself", () => {
    const bs: Bottle[] = [[pill(1, 0)]];
    expect(canMove(bs, 0, 0)).toBe(false);
  });
});
