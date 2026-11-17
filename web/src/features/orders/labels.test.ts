import { describe, expect, test } from "vitest";
import { MIRROR_REASONS, ORDER_OUTCOMES } from "@/config/orderAbis";
import { MIRROR_REASON_TEXT, NOT_WATCHED_REASONS, orderSentence, orderStatusBadge, OUTCOME_TEXT } from "./labels";

describe("orderStatusBadge", () => {
  test("describes an open order as waiting for the price", () => {
    expect(orderStatusBadge("Open", false)).toEqual({ label: "Waiting for the price", tone: "accent" });
  });

  test("tells an open order past its expiry apart, since its tokens can still be reclaimed", () => {
    expect(orderStatusBadge("Open", true)).toEqual({ label: "Expired, cancel to refund", tone: "warn" });
  });

  test("labels the closed states", () => {
    expect(orderStatusBadge("Filled", false)).toEqual({ label: "Filled", tone: "ok" });
    expect(orderStatusBadge("Cancelled", false).label).toBe("Cancelled");
    expect(orderStatusBadge("Expired", true).label).toBe("Expired, refunded");
    expect(orderStatusBadge("None", false).label).toBe("Not found");
  });
});

describe("plain-language texts", () => {
  test("exist for every outcome and every mirror reason", () => {
    for (const outcome of ORDER_OUTCOMES) expect(OUTCOME_TEXT[outcome].title.length).toBeGreaterThan(0);
    for (const reason of MIRROR_REASONS) expect(MIRROR_REASON_TEXT[reason].length).toBeGreaterThan(0);
  });

  test("tell the visitor how to get the tokens back whenever an order is not watched", () => {
    for (const reason of NOT_WATCHED_REASONS) {
      expect(MIRROR_REASON_TEXT[reason]).toMatch(/cancel/i);
      expect(MIRROR_REASON_TEXT[reason]).toMatch(/tokens back/);
    }
  });

  test("say a slippage skip leaves the order open", () => {
    expect(OUTCOME_TEXT.SkippedSlippage.detail).toMatch(/stays open/);
  });
});

describe("orderSentence", () => {
  test("says what each kind of order will do", () => {
    expect(orderSentence("stop-loss", "0.5 WETH", "2,970.00")).toBe("Sell 0.5 WETH if the price falls to 2,970.00 USDC");
    expect(orderSentence("take-profit", "0.5 WETH", "3,030.00")).toBe("Sell 0.5 WETH if the price rises to 3,030.00 USDC");
    expect(orderSentence("limit-buy", "1,000 USDC", "2,970.00")).toBe("Buy WETH with 1,000 USDC if the price falls to 2,970.00 USDC");
  });

  test("falls back for an order this page did not create", () => {
    expect(orderSentence(undefined, "5 USDC", "1.00")).toBe("Custom order of 5 USDC at 1.00 USDC");
  });
});
