import { describe, expect, test } from "vitest";
import {
  bestRoute,
  gapBps,
  getAmountOut,
  reservesAfterSwap,
  roundTrip,
  spotPriceUsdc,
  type Reserves,
} from "./amm";

const WETH = 10n ** 18n;
const USDC = 10n ** 6n;
const FEE_BPS = 30n;
const poolAt3000: Reserves = { weth: 100n * WETH, usdc: 300_000n * USDC };
const poolAt3060: Reserves = { weth: 100n * WETH, usdc: 306_000n * USDC };

describe("getAmountOut", () => {
  test("matches the constant-product formula after fee", () => {
    const out = getAmountOut(1_000n * USDC, poolAt3000.usdc, poolAt3000.weth, FEE_BPS);

    // 997 * 100e18 / (300_000 + 997) = 0.33123...e18
    expect(out).toBe((997n * USDC * 100n * WETH * 10n) / (300_000n * USDC * 10n + 997n * USDC * 10n));
  });

  test("returns zero when an input or a reserve is zero", () => {
    expect(getAmountOut(0n, 1n, 1n, FEE_BPS)).toBe(0n);
    expect(getAmountOut(1n, 0n, 1n, FEE_BPS)).toBe(0n);
    expect(getAmountOut(1n, 1n, 0n, FEE_BPS)).toBe(0n);
  });
});

describe("roundTrip", () => {
  test("reproduces the reference fixture: 1,000 USDC returns about 1,007.2 when B is at 3,060", () => {
    const out = roundTrip(1_000n * USDC, poolAt3000, poolAt3060, FEE_BPS);

    expect(out).toBeGreaterThan(1_007n * USDC);
    expect(out).toBeLessThan(1_008n * USDC);
  });

  test("loses the fees when both pools have the same price", () => {
    const out = roundTrip(1_000n * USDC, poolAt3000, poolAt3000, FEE_BPS);

    expect(out).toBeLessThan(1_000n * USDC);
  });
});

describe("bestRoute", () => {
  test("buys on the cheaper pool", () => {
    expect(bestRoute(1_000n * USDC, poolAt3000, poolAt3060, FEE_BPS).route).toBe("buyA");
    expect(bestRoute(1_000n * USDC, poolAt3060, poolAt3000, FEE_BPS).route).toBe("buyB");
  });
});

describe("reservesAfterSwap", () => {
  test("moves USDC in and WETH out without mutating the input", () => {
    const before = { ...poolAt3000 };

    const { reserves, amountOut } = reservesAfterSwap(poolAt3000, "usdc", 3_000n * USDC, FEE_BPS);

    expect(poolAt3000).toEqual(before);
    expect(reserves.usdc).toBe(303_000n * USDC);
    expect(reserves.weth).toBe(poolAt3000.weth - amountOut);
    expect(amountOut).toBeGreaterThan(0n);
  });

  test("moves WETH in and USDC out", () => {
    const { reserves, amountOut } = reservesAfterSwap(poolAt3000, "weth", WETH, FEE_BPS);

    expect(reserves.weth).toBe(101n * WETH);
    expect(reserves.usdc).toBe(poolAt3000.usdc - amountOut);
  });
});

describe("spotPriceUsdc and gapBps", () => {
  test("reports the price as USDC per WETH with 6 decimals", () => {
    expect(spotPriceUsdc(poolAt3000)).toBe(3_000n * USDC);
    expect(spotPriceUsdc({ weth: 0n, usdc: 1n })).toBe(0n);
  });

  test("reports the gap of one price against another in basis points", () => {
    expect(gapBps(3_060n * USDC, 3_000n * USDC)).toBe(200);
    expect(gapBps(2_970n * USDC, 3_000n * USDC)).toBe(-100);
    expect(gapBps(1n, 0n)).toBe(0);
  });
});
