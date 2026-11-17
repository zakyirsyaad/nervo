import { describe, expect, it } from "vitest";
import { bandScale } from "./scale";

describe("bandScale", () => {
  it("puts the highest value at the top and the lowest at the bottom, inside the plot", () => {
    const scale = bandScale([3_000, 3_060], 3_000, 0.15);
    expect(scale.y(3_060)).toBeLessThan(scale.y(3_000));
    expect(scale.y(3_060)).toBeGreaterThan(0);
    expect(scale.y(3_000)).toBeLessThan(1);
  });

  it("holds a wild swing at the edge instead of letting it flatten everything else", () => {
    const scale = bandScale([3_000, 3_060, 74], 3_000, 0.15);
    expect(scale.min).toBeGreaterThan(2_900);
    expect(scale.y(74)).toBe(1);
    expect(scale.isClipped(74)).toBe(true);
    expect(scale.isClipped(3_060)).toBe(false);
  });

  it("always keeps the values it is told to, such as a trigger far from the price", () => {
    const scale = bandScale([3_000], 3_000, 0.15, [4_000]);
    expect(scale.isClipped(4_000)).toBe(false);
    expect(scale.y(4_000)).toBeLessThan(scale.y(3_000));
  });

  it("gives a flat series some room and stays usable with nothing to plot", () => {
    const flat = bandScale([3_000], 3_000, 0.15);
    expect(flat.y(3_000)).toBeCloseTo(0.5);
    expect(flat.max).toBeGreaterThan(flat.min);
    expect(bandScale([], 0, 0.15).y(3_000)).toBe(0.5);
  });
});
