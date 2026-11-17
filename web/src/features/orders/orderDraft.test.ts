import { describe, expect, test } from "vitest";
import { orderBlocker, type DraftCheck } from "./orderDraft";

const WETH = 10n ** 18n;
const USDC = 10n ** 6n;

const ready: DraftCheck = {
  deployment: "deployed",
  hasPrices: true,
  watchedCount: 1,
  amountText: "0.5",
  amountIn: WETH / 2n,
  minimum: WETH / 1_000n,
  minimumLabel: "0.001 WETH",
  example: "0.5",
  balance: 5n * WETH,
  triggerPrice: 2_970n * USDC,
  minAmountOut: 1_400n * USDC,
  orderFee: 10n ** 14n,
  ethBalance: 10n ** 16n,
};

describe("orderBlocker", () => {
  test("lets a complete order through", () => {
    expect(orderBlocker(ready)).toBeUndefined();
  });

  test("explains that the contracts are not deployed yet before anything else", () => {
    expect(orderBlocker({ ...ready, deployment: "missing", amountText: "" })).toMatch(/not deployed/);
    expect(orderBlocker({ ...ready, deployment: "checking" })).toMatch(/Checking/);
    expect(orderBlocker({ ...ready, deployment: "error" })).toMatch(/Cannot reach/);
  });

  test("stops at the per-person limit of watched orders", () => {
    expect(orderBlocker({ ...ready, watchedCount: 4 })).toMatch(/4 orders being watched/);
    expect(orderBlocker({ ...ready, watchedCount: undefined })).toBeUndefined();
  });

  test("asks for a valid amount of at least the minimum and within the balance", () => {
    expect(orderBlocker({ ...ready, amountText: " ", amountIn: null })).toBe("Enter an amount.");
    expect(orderBlocker({ ...ready, amountText: "1,5", amountIn: null })).toMatch(/for example 0\.5/);
    expect(orderBlocker({ ...ready, amountIn: WETH / 10_000n })).toBe("The smallest order is 0.001 WETH.");
    expect(orderBlocker({ ...ready, amountIn: 6n * WETH })).toMatch(/do not have enough/);
  });

  test("needs a trigger price and a minimum to receive above zero", () => {
    expect(orderBlocker({ ...ready, triggerPrice: null })).toMatch(/trigger price/);
    expect(orderBlocker({ ...ready, triggerPrice: 0n })).toMatch(/trigger price/);
    expect(orderBlocker({ ...ready, minAmountOut: 0n })).toMatch(/at least/);
  });

  test("waits for the trigger fee and asks for ETH on Unichain to pay it", () => {
    expect(orderBlocker({ ...ready, orderFee: undefined })).toMatch(/fee/);
    expect(orderBlocker({ ...ready, ethBalance: 10n ** 13n })).toMatch(/Unichain Sepolia ETH/);
  });

  test("waits for prices before checking the fields", () => {
    expect(orderBlocker({ ...ready, hasPrices: false })).toBe("Loading prices…");
  });
});
