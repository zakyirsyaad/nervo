import { describe, expect, test } from "vitest";
import { applySlippage, previewSwap, type PoolPair } from "./quote";

const WETH = 10n ** 18n;
const USDC = 10n ** 6n;
const balanced: PoolPair = {
  A: { weth: 100n * WETH, usdc: 300_000n * USDC },
  B: { weth: 100n * WETH, usdc: 300_000n * USDC },
};

describe("previewSwap", () => {
  test("a 3,000 USDC buy on Pool B opens a gap that clears the callback threshold", () => {
    const preview = previewSwap({ pools: balanced, pool: "B", tokenIn: "usdc", amountIn: 3_000n * USDC });

    expect(preview.amountOut).toBeGreaterThan(98n * WETH / 100n);
    expect(preview.amountOut).toBeLessThan(WETH);
    expect(preview.gapBps).toBeGreaterThan(190);
    expect(preview.gapBps).toBeLessThan(210);
    expect(preview.willRequestCallback).toBe(true);
    expect(preview.route).toBe("buyA");
  });

  test("a small swap moves the price but stays below the threshold", () => {
    const preview = previewSwap({ pools: balanced, pool: "B", tokenIn: "usdc", amountIn: 300n * USDC });

    expect(preview.gapBps).toBeGreaterThan(0);
    expect(preview.willRequestCallback).toBe(false);
  });

  test("selling WETH on Pool A lowers its price, so the executor buys on A", () => {
    const preview = previewSwap({ pools: balanced, pool: "A", tokenIn: "weth", amountIn: WETH });

    expect(preview.gapBps).toBeLessThan(0);
    expect(preview.route).toBe("buyA");
    expect(preview.willRequestCallback).toBe(true);
  });

  test("a zero amount leaves the pool where it is", () => {
    const preview = previewSwap({ pools: balanced, pool: "A", tokenIn: "usdc", amountIn: 0n });

    expect(preview.amountOut).toBe(0n);
    expect(preview.gapBps).toBe(0);
    expect(preview.willRequestCallback).toBe(false);
  });
});

describe("applySlippage", () => {
  test("lowers the minimum output by the tolerance", () => {
    expect(applySlippage(10_000n, 50n)).toBe(9_950n);
  });
});
