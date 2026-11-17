import { describe, expect, test } from "vitest";
import { ORDER_CONDITIONS } from "@/config/orderAbis";
import { getAmountOut } from "@/lib/amm";
import {
  conditionIndex,
  defaultTriggerPrice,
  EXPIRY_CHOICES,
  expiryAt,
  KIND_SPEC,
  kindFor,
  ORDER_KINDS,
  outputToken,
  quoteMinOut,
  triggersImmediately,
} from "./kinds";

const WETH = 10n ** 18n;
const USDC = 10n ** 6n;
const FEE_BPS = 30n;
const pool = { weth: 100n * WETH, usdc: 300_000n * USDC };

describe("order kinds", () => {
  test("map to the token and condition the OrderBook expects", () => {
    expect(KIND_SPEC["stop-loss"]).toMatchObject({ tokenIn: "weth", condition: "PriceAtOrBelow" });
    expect(KIND_SPEC["take-profit"]).toMatchObject({ tokenIn: "weth", condition: "PriceAtOrAbove" });
    expect(KIND_SPEC["limit-buy"]).toMatchObject({ tokenIn: "usdc", condition: "PriceAtOrBelow" });
  });

  test("encode the condition with the Solidity enum order", () => {
    expect(conditionIndex("PriceAtOrBelow")).toBe(0);
    expect(conditionIndex("PriceAtOrAbove")).toBe(1);
    expect(ORDER_CONDITIONS).toEqual(["PriceAtOrBelow", "PriceAtOrAbove"]);
  });

  test("are recognised again from an order read back from the chain", () => {
    for (const kind of ORDER_KINDS) {
      expect(kindFor(KIND_SPEC[kind].tokenIn, KIND_SPEC[kind].condition)).toBe(kind);
    }
  });

  test("leave a combination the page never places unnamed", () => {
    expect(kindFor("usdc", "PriceAtOrAbove")).toBeUndefined();
  });

  test("sell WETH for USDC, or buy WETH with USDC", () => {
    expect(outputToken("weth")).toBe("usdc");
    expect(outputToken("usdc")).toBe("weth");
  });
});

describe("defaultTriggerPrice", () => {
  test("sits 1% below the price for a stop-loss or a limit buy and 1% above for a take-profit", () => {
    const price = 3_000n * USDC;

    expect(defaultTriggerPrice(price, "stop-loss")).toBe(2_970n * USDC);
    expect(defaultTriggerPrice(price, "limit-buy")).toBe(2_970n * USDC);
    expect(defaultTriggerPrice(price, "take-profit")).toBe(3_030n * USDC);
  });
});

describe("quoteMinOut", () => {
  test("quotes a WETH sale on the Unichain pool and keeps 99% of it as the minimum", () => {
    const quote = quoteMinOut(pool, "weth", WETH, FEE_BPS);
    const expected = getAmountOut(WETH, pool.weth, pool.usdc, FEE_BPS);

    expect(quote.amountOut).toBe(expected);
    expect(quote.minAmountOut).toBe((expected * 9_900n) / 10_000n);
  });

  test("quotes a WETH purchase with USDC", () => {
    const quote = quoteMinOut(pool, "usdc", 3_000n * USDC, FEE_BPS);

    expect(quote.amountOut).toBe(getAmountOut(3_000n * USDC, pool.usdc, pool.weth, FEE_BPS));
    expect(quote.minAmountOut).toBeLessThan(quote.amountOut);
  });

  test("returns zero for an empty pool", () => {
    expect(quoteMinOut({ weth: 0n, usdc: 0n }, "weth", WETH, FEE_BPS)).toEqual({ amountOut: 0n, minAmountOut: 0n });
  });
});

describe("triggersImmediately", () => {
  test("is true when the current price already meets the condition", () => {
    expect(triggersImmediately("stop-loss", 3_100n * USDC, 3_000n * USDC)).toBe(true);
    expect(triggersImmediately("take-profit", 2_900n * USDC, 3_000n * USDC)).toBe(true);
    expect(triggersImmediately("limit-buy", 3_000n * USDC, 3_000n * USDC)).toBe(true);
  });

  test("is false for a trigger on the far side of the price", () => {
    expect(triggersImmediately("stop-loss", 2_970n * USDC, 3_000n * USDC)).toBe(false);
    expect(triggersImmediately("take-profit", 3_030n * USDC, 3_000n * USDC)).toBe(false);
  });
});

describe("expiry", () => {
  test("offers 1 hour, 1 day and 7 days less a minute, within the 7-day limit", () => {
    expect(EXPIRY_CHOICES.map((choice) => choice.seconds)).toEqual([3_600n, 86_400n, 604_740n]);
  });

  test("counts from the chain time", () => {
    expect(expiryAt(1_800_000_000n, EXPIRY_CHOICES[0])).toBe(1_800_003_600n);
  });
});
