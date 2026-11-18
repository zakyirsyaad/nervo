import { describe, expect, test } from "vitest";
import { readOrderDetails, scanPlacedOrders } from "./scan";
import { trailStatus } from "./trail";
import { fetchTrailSnapshot } from "./trailFetch";

// Reads the public testnet RPCs, so it only runs on request: LIVE=1 pnpm test
// Order 1 is the stop-loss placed by script/OrderScenario.s.sol right after the deploy. Its blocks come from
// evidence/order-2026-11-17.json. The app only looks back about 14 hours on Unichain, so the test reads closed
// ranges around those blocks instead of reading to the chain head.
const SCENARIO_ORDER = {
  id: 1n,
  txHash: "0xe2fd4f048a4c02a1b702058ddd9621206de0ca27863b1b316ccd74c5adb1b1fa",
  blockNumber: 68_055_182n,
} as const;
const SCENARIO_OUTCOME_BLOCK = 68_055_270n;
const SCENARIO_LASNA_MIRROR_BLOCK = 8_560_254n;
const SCENARIO_LASNA_CLOSED_BLOCK = 8_560_334n;
const MARGIN_BLOCKS = 5n;

describe.runIf(process.env.LIVE === "1")("order tracker against the scenario order", () => {
  test("finds the order among its owner's OrderPlaced logs", async () => {
    const { owner } = await readOrderDetails(SCENARIO_ORDER.id);
    const range = {
      fromBlock: SCENARIO_ORDER.blockNumber - MARGIN_BLOCKS,
      toBlock: SCENARIO_ORDER.blockNumber + MARGIN_BLOCKS,
    };

    const cache = await scanPlacedOrders(owner, { scannedTo: undefined, refs: [] }, range);

    expect(cache.refs).toContainEqual(SCENARIO_ORDER);
  }, 60_000);

  test("follows it from placement to its outcome on Unichain", async () => {
    const window = {
      lasna: {
        fromBlock: SCENARIO_LASNA_MIRROR_BLOCK - MARGIN_BLOCKS,
        toBlock: SCENARIO_LASNA_CLOSED_BLOCK + MARGIN_BLOCKS,
      },
      unichainToBlock: SCENARIO_OUTCOME_BLOCK + MARGIN_BLOCKS,
    };

    const snapshot = await fetchTrailSnapshot(SCENARIO_ORDER, undefined, window);
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
