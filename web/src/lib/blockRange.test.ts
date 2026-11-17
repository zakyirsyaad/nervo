import { describe, expect, test } from "vitest";
import { estimateStartBlock, lookbackStart, nextScanStart, splitRange } from "./blockRange";

describe("splitRange", () => {
  test("splits a range into pieces of at most the given size, oldest first", () => {
    expect(splitRange(1n, 2_500n, 1_000n)).toEqual([
      { fromBlock: 1n, toBlock: 1_000n },
      { fromBlock: 1_001n, toBlock: 2_000n },
      { fromBlock: 2_001n, toBlock: 2_500n },
    ]);
  });

  test("keeps a range that fits as one piece, including a single block", () => {
    expect(splitRange(10n, 10n, 1_000n)).toEqual([{ fromBlock: 10n, toBlock: 10n }]);
    expect(splitRange(0n, 999n, 1_000n)).toEqual([{ fromBlock: 0n, toBlock: 999n }]);
  });

  test("returns nothing when the start is after the end", () => {
    expect(splitRange(11n, 10n, 1_000n)).toEqual([]);
  });

  test("rejects a piece size below one block", () => {
    expect(() => splitRange(1n, 2n, 0n)).toThrow(RangeError);
  });
});

describe("lookbackStart", () => {
  test("covers exactly the requested number of blocks up to the head", () => {
    expect(lookbackStart(100_000n, 50_000n)).toBe(50_001n);
  });

  test("never starts before the deploy block or block zero", () => {
    expect(lookbackStart(100_000n, 50_000n, 80_000n)).toBe(80_000n);
    expect(lookbackStart(1_000n, 50_000n)).toBe(0n);
  });
});

describe("nextScanStart", () => {
  test("resumes right after the last scanned block when it is inside the window", () => {
    expect(nextScanStart(90_000n, 50_001n)).toBe(90_001n);
  });

  test("falls back to the window start when there is no cursor or it is too old", () => {
    expect(nextScanStart(undefined, 50_001n)).toBe(50_001n);
    expect(nextScanStart(10n, 50_001n)).toBe(50_001n);
  });
});

describe("estimateStartBlock", () => {
  test("goes back one block per elapsed second plus a margin, so it never starts too late", () => {
    const start = estimateStartBlock({ head: 1_000n, headTimestamp: 5_000n, sinceTimestamp: 4_900n, margin: 30n, maxLookback: 10_000n });

    expect(start).toEqual({ fromBlock: 870n, isPartial: false });
  });

  test("caps the look-back and says the history is partial", () => {
    const start = estimateStartBlock({ head: 1_000_000n, headTimestamp: 900_000n, sinceTimestamp: 0n, margin: 30n, maxLookback: 90_000n });

    expect(start).toEqual({ fromBlock: 910_000n, isPartial: true });
  });

  test("uses only the margin when the event looks newer than the head, and stops at block zero", () => {
    expect(estimateStartBlock({ head: 500n, headTimestamp: 100n, sinceTimestamp: 200n, margin: 30n, maxLookback: 90_000n })).toEqual({
      fromBlock: 470n,
      isPartial: false,
    });
    expect(estimateStartBlock({ head: 10n, headTimestamp: 100n, sinceTimestamp: 0n, margin: 30n, maxLookback: 90_000n })).toEqual({
      fromBlock: 0n,
      isPartial: false,
    });
  });
});
