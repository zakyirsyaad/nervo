import { describe, expect, test } from "vitest";
import { mapLimited } from "./concurrency";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("mapLimited", () => {
  test("keeps the results in input order even when tasks finish out of order", async () => {
    const results = await mapLimited([30, 10, 20], 3, async (ms) => {
      await delay(ms);
      return ms * 2;
    });

    expect(results).toEqual([60, 20, 40]);
  });

  test("never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;

    await mapLimited([1, 2, 3, 4, 5, 6, 7], 3, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await delay(5);
      running -= 1;
    });

    expect(peak).toBe(3);
  });

  test("rejects when a task fails", async () => {
    const run = mapLimited([1, 2, 3], 2, async (value) => {
      if (value === 2) throw new Error("range too large");
      return value;
    });

    await expect(run).rejects.toThrow("range too large");
  });

  test("returns an empty list for no items", async () => {
    expect(await mapLimited([], 4, async (value: number) => value)).toEqual([]);
  });
});
