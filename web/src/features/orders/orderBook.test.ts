import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import type { PriceStep } from "@/features/trade/history";
import { buildBookRows, firedSteps, summarizeBook, type BookOutcome } from "./orderBook";
import type { OrderView } from "./orderList";

const OWNER = "0x9200000000000000000000000000000000006c90" as Address;
const USDC_UNIT = 10n ** 6n;

function hash(n: number): Hex {
  return `0x${n.toString(16).padStart(64, "0")}`;
}

function view(id: number, status: OrderView["status"] = "Filled"): OrderView {
  return {
    ref: { id: BigInt(id), txHash: hash(id), blockNumber: 68_064_000n + BigInt(id) },
    owner: OWNER,
    kind: "stop-loss",
    tokenIn: "weth",
    amountIn: 10n ** 17n,
    triggerPrice: 3_301_304_014n,
    minAmountOut: 316_464_691n,
    expiry: 1_800_000_000n,
    status,
    isExpired: false,
  };
}

function outcome(orderId: number, kind: BookOutcome["outcome"], blockNumber: bigint, source: number, at: number): BookOutcome {
  return {
    orderId: BigInt(orderId),
    outcome: kind,
    amountOut: 324_952_732n,
    observedPrice: 3_294_674_890n,
    sourceTimestamp: BigInt(source),
    timestamp: BigInt(at),
    txHash: hash(1_000 + orderId),
    blockNumber,
    logIndex: 0,
  };
}

describe("buildBookRows", () => {
  it("lists the newest order first, with its latest outcome and the whole seconds to fill", () => {
    const rows = buildBookRows(
      [view(10), view(11), view(12, "Open")],
      [outcome(11, "SkippedSlippage", 100n, 1_000, 1_001), outcome(11, "Filled", 200n, 1_000, 1_002), outcome(10, "Filled", 90n, 990, 993)],
    );
    expect(rows.map((row) => row.view.ref.id)).toEqual([12n, 11n, 10n]);
    expect(rows[0]).toMatchObject({ outcome: undefined, fillSeconds: undefined });
    expect(rows[1].outcome?.outcome).toBe("Filled");
    expect(rows[1].fillSeconds).toBe(2);
    expect(rows[2].fillSeconds).toBe(3);
  });

  it("keeps a fill even when a later callback for the same order was skipped", () => {
    const [row] = buildBookRows([view(11)], [outcome(11, "Filled", 100n, 1_000, 1_002), outcome(11, "SkippedNotOpen", 101n, 1_000, 1_003)]);
    expect(row.outcome?.outcome).toBe("Filled");
    expect(row.fillSeconds).toBe(2);
  });
});

describe("summarizeBook", () => {
  it("counts fired and filled orders and gives the middle and fastest fill", () => {
    const rows = buildBookRows(
      [view(1), view(2), view(3), view(4, "Open")],
      [outcome(1, "Filled", 1n, 10, 12), outcome(2, "Filled", 2n, 20, 21), outcome(3, "SkippedSlippage", 3n, 30, 31)],
    );
    expect(summarizeBook(rows)).toEqual({ fired: 3, filled: 2, typicalSeconds: 1, fastestSeconds: 1 });
    expect(summarizeBook([])).toEqual({ fired: 0, filled: 0, typicalSeconds: undefined, fastestSeconds: undefined });
  });
});

describe("firedSteps", () => {
  const step = (key: string, timestamp: number, priceA: bigint, touches: PriceStep["touches"] = ["A"]): PriceStep => ({
    key,
    txHash: hash(key.length),
    timestamp,
    actor: OWNER,
    hasSwap: true,
    byContract: false,
    touches,
    priceA,
    priceB: priceA,
  });

  it("marks the Pool A change in the same second with the closest price", () => {
    const steps = [
      step("restore", 1_000, 3_314_562_264n),
      step("drop", 1_000, 3_294_674_890n),
      step("other pool", 1_000, 3_294_674_890n, ["B"]),
    ];
    const fired = firedSteps(steps, [outcome(11, "Filled", 1n, 1_000, 1_002)]);
    expect([...fired.entries()]).toEqual([["drop", [11n]]]);
  });

  it("marks nothing when the price change is outside the history", () => {
    expect(firedSteps([step("drop", 999, 3_294_674_890n)], [outcome(11, "Filled", 1n, 1_000, 1_002)]).size).toBe(0);
  });

  it("keeps every order one change fired", () => {
    const fired = firedSteps([step("drop", 1_000, 3_294n * USDC_UNIT)], [outcome(10, "Filled", 1n, 1_000, 1_002), outcome(11, "Filled", 2n, 1_000, 1_002)]);
    expect(fired.get("drop")).toEqual([10n, 11n]);
  });
});
