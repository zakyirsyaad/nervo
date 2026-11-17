import { describe, expect, test } from "vitest";
import type { Hex } from "viem";
import type { OrderView } from "./orderList";
import { EMPTY_TRAIL, trailStatus, type OrderTrail, type TrailState } from "./trail";
import { mirrorText, outcomeText, placedText, triggerText, type TrackerInput } from "./trackerText";

const TX: Hex = `0x${"11".repeat(32)}`;
const ref = { id: 3n, txHash: TX, blockNumber: 68_000_000n };
const order: OrderView = {
  ref,
  owner: "0x00000000000000000000000000000000000000a1",
  kind: "stop-loss",
  tokenIn: "weth",
  amountIn: 5n * 10n ** 17n,
  triggerPrice: 2_970_000_000n,
  minAmountOut: 1_400_000_000n,
  expiry: 2_000_000_000n,
  status: "Open",
  isExpired: false,
};
const position = { txHash: TX, blockNumber: 9n, logIndex: 0 };

function input(trail: Partial<OrderTrail>, view: OrderView = order, extra: Partial<TrailState> = {}): TrackerInput {
  const state: TrailState = {
    trail: { ...EMPTY_TRAIL, ...trail },
    orderStatus: view.status,
    isExpired: view.isExpired,
    hasMirrorTimedOut: false,
    hasError: false,
    ...extra,
  };
  return { ref, trail: state.trail, order: view, isLasnaPartial: false, isUnichainPartial: false, status: trailStatus(state) };
}

describe("tracker step texts", () => {
  test("step 1 links the placement on Unichain", () => {
    const text = placedText(input({}));

    expect(text.detail).toMatch(/0\.5000 WETH is held by the order book/);
    expect(text.link).toEqual({ chain: "unichain", hash: TX });
  });

  test("step 2 explains why an order is not watched and how to get the tokens back", () => {
    const text = mirrorText(input({ mirrors: [{ ...position, state: "Open", reason: "OwnerLimit" }] }));

    expect(text.title).toBe("Not watched");
    expect(text.detail).toMatch(/4 orders being watched/);
    expect(text.detail).toMatch(/cancel the order to get your tokens back/);
    expect(text.tech).toMatch(/OrderMirrored · OwnerLimit · Reactive Lasna/);
  });

  test("step 3 names the trigger while waiting and the Base price once reached", () => {
    expect(triggerText(input({ mirrors: [{ ...position, state: "Open", reason: "Placed" }] })).detail).toMatch(
      /2,970\.00 USDC or below/,
    );
    const reached = triggerText(
      input({ triggers: [{ ...position, price: 2_965_500_000n, sourceTimestamp: 100n, afterTimeout: false }] }),
    );

    expect(reached.detail).toMatch(/2,965\.50 USDC/);
  });

  test("step 4 reports the fill in whole seconds and the amount received", () => {
    const text = outcomeText(
      input({
        outcomes: [
          {
            ...position,
            outcome: "Filled",
            amountOut: 1_480_120_000n,
            observedPrice: 2_965_500_000n,
            sourceTimestamp: 100n,
            timestamp: 103n,
          },
        ],
      }),
    );

    expect(text.title).toBe("Filled in 3 seconds");
    expect(text.detail).toMatch(/1,480\.12 USDC/);
  });

  test("step 4 tells the owner of an expired open order to cancel", () => {
    const text = outcomeText(input({}, { ...order, isExpired: true }));

    expect(text.detail).toMatch(/Cancel the order to get them back/);
  });
});

describe("wording for someone else's order", () => {
  test("says the order, not your order", () => {
    const others = { ...input({}), isOwn: false };
    expect(placedText(others).detail).toContain("until the trigger is reached or the owner cancels");
    expect(mirrorText(others).title).not.toContain("your");
    expect(triggerText(others).detail).not.toContain("your");
  });
});
