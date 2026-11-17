import { describe, expect, test } from "vitest";
import type { Hex } from "viem";
import {
  appendTrail,
  EMPTY_TRAIL,
  latencySeconds,
  trailStatus,
  trailSteps,
  type MirrorRecord,
  type OrderTrail,
  type OutcomeRecord,
  type TrailState,
  type TriggerRecord,
} from "./trail";

function hash(seed: number): Hex {
  return `0x${seed.toString(16).padStart(64, "0")}`;
}

function mirror(reason: MirrorRecord["reason"], state: MirrorRecord["state"] = "Open", seed = 1): MirrorRecord {
  return { reason, state, txHash: hash(seed), blockNumber: BigInt(seed), logIndex: 0 };
}

function trigger(seed = 10): TriggerRecord {
  return { price: 2_960_000_000n, sourceTimestamp: 1_000n, afterTimeout: false, txHash: hash(seed), blockNumber: BigInt(seed), logIndex: 0 };
}

function outcome(kind: OutcomeRecord["outcome"], seed = 20): OutcomeRecord {
  return {
    outcome: kind,
    amountOut: kind === "Filled" ? 2_950_000_000n : 0n,
    observedPrice: 2_960_000_000n,
    sourceTimestamp: 1_000n,
    timestamp: 1_003n,
    txHash: hash(seed),
    blockNumber: BigInt(seed),
    logIndex: 1,
  };
}

function state(trail: Partial<OrderTrail>, extra: Partial<TrailState> = {}): TrailState {
  return {
    trail: { ...EMPTY_TRAIL, ...trail },
    orderStatus: "Open",
    isExpired: false,
    hasMirrorTimedOut: false,
    hasError: false,
    ...extra,
  };
}

describe("appendTrail", () => {
  test("adds new events once, in block order, without changing the old trail", () => {
    const first = appendTrail(EMPTY_TRAIL, { mirrors: [mirror("Placed", "Open", 5)] });
    const second = appendTrail(first, { mirrors: [mirror("Placed", "Open", 5), mirror("Rearmed", "Open", 3)], triggers: [trigger()] });

    expect(first.mirrors).toHaveLength(1);
    expect(second.mirrors.map((entry) => entry.reason)).toEqual(["Rearmed", "Placed"]);
    expect(second.triggers).toHaveLength(1);
    expect(EMPTY_TRAIL.mirrors).toHaveLength(0);
  });
});

describe("latencySeconds", () => {
  test("counts whole seconds from the Base block to the Unichain block", () => {
    expect(latencySeconds({ sourceTimestamp: 1_000n, timestamp: 1_003n })).toBe(3);
  });

  test("never reports a negative time", () => {
    expect(latencySeconds({ sourceTimestamp: 1_005n, timestamp: 1_003n })).toBe(0);
  });
});

describe("trailStatus", () => {
  test("waits for Reactive to pick the order up, then gives up after the timeout", () => {
    expect(trailStatus(state({}))).toMatchObject({ kind: "waiting-mirror", isSettled: false });
    expect(trailStatus(state({}, { hasMirrorTimedOut: true }))).toMatchObject({ kind: "mirror-timeout", isSettled: true });
  });

  test("watches the price once the order is mirrored, and waits for the trade once triggered", () => {
    expect(trailStatus(state({ mirrors: [mirror("Placed")] })).kind).toBe("watching");
    expect(trailStatus(state({ mirrors: [mirror("Placed")], triggers: [trigger()] })).kind).toBe("triggered");
  });

  test("ends filled on a Filled outcome, or on the order book status alone", () => {
    const filled = state({ mirrors: [mirror("Placed")], triggers: [trigger()], outcomes: [outcome("Filled")] }, { orderStatus: undefined });

    expect(trailStatus(filled)).toMatchObject({ kind: "filled", isSettled: true });
    expect(trailStatus(state({}, { orderStatus: "Filled" })).kind).toBe("filled");
  });

  test("keeps watching after a slippage skip", () => {
    const retry = state({ mirrors: [mirror("Placed")], triggers: [trigger()], outcomes: [outcome("SkippedSlippage")] });

    expect(trailStatus(retry)).toMatchObject({ kind: "retrying", isSettled: false });
  });

  test("stops when the order is not watched or no longer watched", () => {
    expect(trailStatus(state({ mirrors: [mirror("OwnerLimit")] }))).toMatchObject({ kind: "not-watched", isSettled: true });
    expect(trailStatus(state({ mirrors: [mirror("PlacedUntracked")] })).kind).toBe("not-watched");
    expect(trailStatus(state({ mirrors: [mirror("Placed"), mirror("RetryLimit", "Closed", 2)] })).kind).toBe("stopped");
    expect(trailStatus(state({ mirrors: [mirror("Placed"), mirror("AttemptLimit", "Closed", 2)] })).kind).toBe("stopped");
  });

  test("reports cancelled and expired orders", () => {
    expect(trailStatus(state({ cancels: [{ txHash: hash(9), blockNumber: 9n, logIndex: 0 }] })).kind).toBe("cancelled");
    expect(trailStatus(state({}, { orderStatus: "Cancelled" })).kind).toBe("cancelled");
    expect(trailStatus(state({ outcomes: [outcome("SkippedExpired")] })).kind).toBe("expired");
    expect(trailStatus(state({ mirrors: [mirror("Placed")] }, { isExpired: true }))).toMatchObject({ kind: "expired-open", isSettled: true });
  });

  test("shows a connection problem only while nothing final is known, and keeps polling", () => {
    expect(trailStatus(state({ mirrors: [mirror("Placed")] }, { hasError: true }))).toMatchObject({ kind: "error", isSettled: false });
    expect(trailStatus(state({ outcomes: [outcome("Filled")] }, { hasError: true })).kind).toBe("filled");
  });
});

describe("trailSteps", () => {
  test("moves the active step along the order's life", () => {
    expect(trailSteps(state({}))).toEqual({ mirror: "active", trigger: "pending", outcome: "pending" });
    expect(trailSteps(state({ mirrors: [mirror("Placed")] }))).toEqual({ mirror: "done", trigger: "active", outcome: "pending" });
    expect(trailSteps(state({ mirrors: [mirror("Placed")], triggers: [trigger()] }))).toEqual({
      mirror: "done",
      trigger: "done",
      outcome: "active",
    });
    expect(trailSteps(state({ mirrors: [mirror("Placed")], triggers: [trigger()], outcomes: [outcome("Filled")] }))).toEqual({
      mirror: "done",
      trigger: "done",
      outcome: "done",
    });
  });

  test("marks the steps that will not happen", () => {
    expect(trailSteps(state({ mirrors: [mirror("OwnerLimit")] }))).toEqual({ mirror: "off", trigger: "off", outcome: "off" });
    expect(trailSteps(state({ mirrors: [mirror("Placed")] }, { orderStatus: "Cancelled" }))).toEqual({
      mirror: "done",
      trigger: "off",
      outcome: "off",
    });
    expect(trailSteps(state({}, { hasMirrorTimedOut: true }))).toEqual({ mirror: "off", trigger: "pending", outcome: "pending" });
  });
});
