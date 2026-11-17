import { describe, expect, test } from "vitest";
import { blockTimestampMs, findTriggerLog, loopStatus, type LoopState } from "./loop";

const POOL_B = "0xf68dE754214b013c206AFD5753b9f26428C29228";
const RESERVE_UPDATE_TOPIC = "0x5ea238b987b0b5b6b7d1e8c7e06d4a9a2f6b4b0e3d1c0a9f8e7d6c5b4a392817";

describe("findTriggerLog", () => {
  const logs = [
    { address: POOL_B.toLowerCase(), topics: ["0xcd3829a3"], logIndex: 28 },
    { address: POOL_B.toLowerCase(), topics: [RESERVE_UPDATE_TOPIC], logIndex: 29 },
    { address: "0xb790467931ad6694747bb90c96ac9b07c0c4de01", topics: [RESERVE_UPDATE_TOPIC], logIndex: 30 },
  ] as const;

  test("picks the pool's ReserveUpdate log regardless of address casing", () => {
    expect(findTriggerLog(logs, POOL_B, RESERVE_UPDATE_TOPIC)).toBe(29);
  });

  test("returns null when the pool emitted no ReserveUpdate", () => {
    expect(findTriggerLog(logs.slice(0, 1), POOL_B, RESERVE_UPDATE_TOPIC)).toBeNull();
  });
});

describe("blockTimestampMs", () => {
  test("prefers the millisecond timestamp Base Sepolia reports", () => {
    expect(blockTimestampMs({ timestamp: "0x6af98e65", timestampMs: "0x1a1ded43b50" })).toBe(1794739813200);
  });

  test("falls back to whole seconds when the field is missing", () => {
    expect(blockTimestampMs({ timestamp: "0x6af98e65" })).toBe(1794739813000);
  });

  test("returns null for a malformed block", () => {
    expect(blockTimestampMs(null)).toBeNull();
    expect(blockTimestampMs({ timestamp: 5 })).toBeNull();
  });
});

describe("loopStatus", () => {
  const base: LoopState = {
    decision: undefined,
    outcome: undefined,
    hasDecisionTimedOut: false,
    hasOutcomeTimedOut: false,
    hasError: false,
  };

  test("waits for Lasna before a decision exists", () => {
    expect(loopStatus(base).kind).toBe("waiting-decision");
  });

  test("waits for the callback once it was requested", () => {
    expect(loopStatus({ ...base, decision: "CallbackRequested" }).kind).toBe("waiting-callback");
  });

  test("ends on Lasna when the margin is below the threshold", () => {
    const status = loopStatus({ ...base, decision: "MarginBelowThreshold" });

    expect(status.kind).toBe("rejected");
    expect(status.isFinal).toBe(true);
  });

  test("reports the executor's outcome", () => {
    expect(loopStatus({ ...base, decision: "CallbackRequested", outcome: "Executed" }).kind).toBe("executed");
    expect(loopStatus({ ...base, decision: "CallbackRequested", outcome: "SkippedMarginGone" }).kind).toBe("skipped");
  });

  test("tells a missing decision apart from a missing callback", () => {
    expect(loopStatus({ ...base, hasDecisionTimedOut: true }).kind).toBe("decision-timeout");
    expect(loopStatus({ ...base, decision: "CallbackRequested", hasOutcomeTimedOut: true }).kind).toBe("callback-timeout");
  });

  test("stops waiting when the chain could not be read, but keeps a result it already has", () => {
    const failed = loopStatus({ ...base, hasError: true });

    expect(failed.kind).toBe("error");
    expect(failed.isFinal).toBe(true);
    expect(loopStatus({ ...base, decision: "MarginBelowThreshold", hasError: true }).kind).toBe("rejected");
  });
});
