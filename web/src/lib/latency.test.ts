import { describe, expect, test } from "vitest";
import { histogram, percentile } from "./latency";

const SAMPLES = [1800, 1200, 1400, 1800, 1600, 1000, 1400, 1000, 1200, 1400, 2000, 1800];

describe("percentile", () => {
  test("matches the published benchmark summary", () => {
    expect(percentile(SAMPLES, 50)).toBe(1400);
    expect(percentile(SAMPLES, 95)).toBe(2000);
  });

  test("returns null for an empty list", () => {
    expect(percentile([], 50)).toBeNull();
  });

  test("does not reorder the caller's array", () => {
    const input = [3, 1, 2];

    percentile(input, 50);

    expect(input).toEqual([3, 1, 2]);
  });
});

describe("histogram", () => {
  test("counts samples per bucket across the whole range, including empty buckets", () => {
    expect(histogram(SAMPLES, 200)).toEqual([
      { value: 1000, count: 2 },
      { value: 1200, count: 2 },
      { value: 1400, count: 3 },
      { value: 1600, count: 1 },
      { value: 1800, count: 3 },
      { value: 2000, count: 1 },
    ]);
    expect(histogram([200, 600], 200)).toEqual([
      { value: 200, count: 1 },
      { value: 400, count: 0 },
      { value: 600, count: 1 },
    ]);
  });

  test("returns no buckets for an empty list", () => {
    expect(histogram([], 200)).toEqual([]);
  });
});
