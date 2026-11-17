import { describe, expect, test } from "vitest";
import { readOrderDetails, scanPlacedOrders } from "./scan";
import { trailStatus } from "./trail";
import { fetchTrailSnapshot } from "./trailFetch";

// Reads the public testnet RPCs, so it only runs on request: LIVE=1 pnpm test
// Order 1 is the stop-loss placed by script/OrderScenario.s.sol right after the deploy.
const SCENARIO_ORDER = {
  id: 1n,
  txHash: "0xe2fd4f048a4c02a1b702058ddd9621206de0ca27863b1b316ccd74c5adb1b1fa",
  blockNumber: 68_055_182n,
} as const;

describe.runIf(process.env.LIVE === "1")("order tracker against the scenario order", () => {
  test("finds the order among its owner's OrderPlaced logs", async () => {
    const { owner } = await readOrderDetails(SCENARIO_ORDER.id);

    const cache = await scanPlacedOrders(owner, { scannedTo: undefined, refs: [] });

    expect(cache.refs).toContainEqual(SCENARIO_ORDER);
  }, 60_000);

  test("follows it from placement to its outcome on Unichain", async () => {
    const snapshot = await fetchTrailSnapshot(SCENARIO_ORDER, undefined);
    const status = trailStatus({
      trail: snapshot.trail,
      orderStatus: snapshot.order.status,
      isExpired: snapshot.order.isExpired,
      hasMirrorTimedOut: false,
      hasError: false,
    });

    expect(snapshot.order.kind).toBe("stop-loss");
    expect(snapshot.trail.mirrors[0]?.reason).toBe("Placed");
    expect(snapshot.trail.triggers.length).toBeGreaterThan(0);
    expect(snapshot.trail.outcomes.length).toBeGreaterThan(0);
    expect(status.isSettled || status.kind === "retrying").toBe(true);
  }, 60_000);
});
