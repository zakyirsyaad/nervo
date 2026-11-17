import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import {
  buildActivity,
  buildPriceSteps,
  groupByTransaction,
  mergeLogs,
  priceScale,
  toPoolLog,
  type PoolLog,
  type PoolTx,
} from "./history";

const POOL_A = "0x82DEA86F73edF0CC76cd2Ff4Ae8612380e63CE6F" as Address;
const POOL_B = "0xf68dE754214b013c206AFD5753b9f26428C29228" as Address;
const WETH = "0x29583A3d63FD02f1bE462d4b6A1B1BeCeFcaFB87" as Address;
const EXECUTOR = "0xb568530a915a7Ae01FBE5917E1B21d666b24DFE4" as Address;
const TRADER = "0x1111111111111111111111111111111111111111" as Address;
const OWNER = "0x2222222222222222222222222222222222222222" as Address;
const POOLS = { A: POOL_A, B: POOL_B };

const WETH_UNIT = 10n ** 18n;
const USDC_UNIT = 10n ** 6n;

function tx(n: number): Hex {
  return `0x${n.toString(16).padStart(64, "0")}`;
}

function reserves(pool: "A" | "B", txHash: Hex, blockNumber: bigint, logIndex: number, weth: bigint, usdc: bigint, initiator: Address): PoolLog {
  return { kind: "reserves", pool, txHash, blockNumber, logIndex, initiator, reserves: { weth, usdc }, timestamp: Number(blockNumber) };
}

function swap(pool: "A" | "B", txHash: Hex, blockNumber: bigint, logIndex: number, sender: Address, wethIn: boolean, amountIn: bigint, amountOut: bigint): PoolLog {
  return { kind: "swap", pool, txHash, blockNumber, logIndex, sender, wethIn, amountIn, amountOut };
}

// The first loop seen on testnet after a wallet test: 3,000 USDC into Pool B, then the contract buys on A and sells on B.
const userSwapLogs: PoolLog[] = [
  reserves("B", tx(1), 59_976_868n, 0, 100n * WETH_UNIT - 899_563_854_437_029_100n, 303_000n * USDC_UNIT, TRADER),
  swap("B", tx(1), 59_976_868n, 1, TRADER, false, 3_000n * USDC_UNIT, 899_563_854_437_029_100n),
];
const arbitrageLogs: PoolLog[] = [
  reserves("A", tx(2), 59_976_876n, 0, 100n * WETH_UNIT - 301_750_619_426_868_600n, 301_000n * USDC_UNIT, EXECUTOR),
  swap("A", tx(2), 59_976_876n, 1, EXECUTOR, false, 1_000n * USDC_UNIT, 301_750_619_426_868_600n),
  reserves("B", tx(2), 59_976_876n, 2, 99_402_186_765_000_000_000n, 301_993_363_083n, EXECUTOR),
  swap("B", tx(2), 59_976_876n, 3, EXECUTOR, true, 301_750_619_426_868_600n, 1_006_636_917n),
];

describe("toPoolLog", () => {
  it("decodes a Swap log and records whether WETH went in", () => {
    const log = toPoolLog(
      {
        address: POOL_B.toLowerCase() as Address,
        eventName: "Swap",
        args: { sender: TRADER, tokenIn: WETH, recipient: TRADER, amountIn: 5n, amountOut: 7n },
        transactionHash: tx(1),
        blockNumber: 10n,
        logIndex: 3,
      },
      POOLS,
      WETH,
    );
    expect(log).toEqual(swap("B", tx(1), 10n, 3, TRADER, true, 5n, 7n));
  });

  it("decodes a ReserveUpdate log with its timestamp in seconds", () => {
    const log = toPoolLog(
      {
        address: POOL_A,
        eventName: "ReserveUpdate",
        args: { initiator: OWNER, reserveWeth: 1n, reserveUsdc: 2n, sequence: 9n, timestamp: 1_794_917_242n },
        transactionHash: tx(4),
        blockNumber: 11n,
        logIndex: 0,
      },
      POOLS,
      WETH,
    );
    expect(log).toEqual({ ...reserves("A", tx(4), 11n, 0, 1n, 2n, OWNER), timestamp: 1_794_917_242 });
  });

  it("ignores pending logs and logs from other contracts", () => {
    const base = { eventName: "Swap" as const, args: { sender: TRADER, tokenIn: WETH, amountIn: 1n, amountOut: 1n }, logIndex: 0 };
    expect(toPoolLog({ ...base, address: TRADER, transactionHash: tx(1), blockNumber: 1n }, POOLS, WETH)).toBeNull();
    expect(toPoolLog({ ...base, address: POOL_A, transactionHash: null, blockNumber: null }, POOLS, WETH)).toBeNull();
  });
});

describe("mergeLogs", () => {
  it("keeps one copy of each log, oldest first, and drops logs before the window", () => {
    const old = reserves("A", tx(9), 5n, 0, 1n, 1n, OWNER);
    const merged = mergeLogs([old, ...userSwapLogs], [...userSwapLogs, ...arbitrageLogs].reverse(), 100n);
    expect(merged).toEqual([...userSwapLogs, ...arbitrageLogs]);
  });
});

describe("groupByTransaction", () => {
  it("turns logs into one entry per transaction with the reserves each pool ended on", () => {
    const txs = groupByTransaction([...arbitrageLogs, ...userSwapLogs]);
    expect(txs.map((entry) => entry.txHash)).toEqual([tx(1), tx(2)]);
    expect(txs[1].actor).toBe(EXECUTOR);
    expect(txs[1].swaps).toHaveLength(2);
    expect(txs[1].after.B).toEqual({ weth: 99_402_186_765_000_000_000n, usdc: 301_993_363_083n });
  });
});

describe("buildActivity", () => {
  const txs = groupByTransaction([...userSwapLogs, ...arbitrageLogs]);

  it("shows the contract's two swaps as one trade with its profit and how soon it followed the swap before it", () => {
    const [latest] = buildActivity(txs, EXECUTOR, 10);
    expect(latest).toMatchObject({
      kind: "arbitrage",
      buyPool: "A",
      sellPool: "B",
      usdcIn: 1_000n * USDC_UNIT,
      usdcOut: 1_006_636_917n,
      profit: 6_636_917n,
      sincePreviousMs: 1_600,
    });
  });

  it("shows anyone else's swap with what they paid and what they got, newest first", () => {
    const entries = buildActivity(txs, EXECUTOR, 10);
    expect(entries[1]).toMatchObject({
      kind: "swap",
      actor: TRADER,
      pool: "B",
      paid: { token: "usdc", amount: 3_000n * USDC_UNIT },
      received: { token: "weth", amount: 899_563_854_437_029_100n },
    });
  });

  it("leaves the follow-up time out when no other transaction came shortly before the trade", () => {
    const [only] = buildActivity(groupByTransaction(arbitrageLogs), EXECUTOR, 10);
    expect(only).toMatchObject({ kind: "arbitrage", sincePreviousMs: undefined });
  });

  it("shows a reserve change without a swap as a reset by the pool owner", () => {
    const reset = groupByTransaction([reserves("A", tx(7), 200n, 0, 100n * WETH_UNIT, 300_000n * USDC_UNIT, OWNER)]);
    expect(buildActivity(reset, EXECUTOR, 10)).toEqual([
      expect.objectContaining({ kind: "reset", actor: OWNER, pools: ["A"], prices: { A: 3_000n * USDC_UNIT } }),
    ]);
  });

  it("returns at most `limit` entries", () => {
    expect(buildActivity(txs, EXECUTOR, 1)).toHaveLength(1);
  });
});

describe("buildPriceSteps", () => {
  it("starts each pool from the reserves before its first swap and carries the other pool forward", () => {
    const steps = buildPriceSteps(groupByTransaction([...userSwapLogs, ...arbitrageLogs]), undefined, 10, EXECUTOR);
    expect(steps).toHaveLength(3);
    // Before anything happened, both pools were at 100 WETH / 300,000 USDC.
    expect(steps[0]).toMatchObject({ txHash: null, priceA: 3_000n * USDC_UNIT, priceB: 3_000n * USDC_UNIT });
    expect(steps[1]).toMatchObject({ txHash: tx(1), byContract: false, priceA: 3_000n * USDC_UNIT });
    expect(steps[1].priceB).toBeGreaterThan(3_000n * USDC_UNIT);
    expect(steps[2]).toMatchObject({ txHash: tx(2), byContract: true });
  });

  it("uses the live reserves for a pool that did not change in the window", () => {
    const steps = buildPriceSteps(
      groupByTransaction(userSwapLogs),
      { A: { weth: WETH_UNIT, usdc: 2_000n * USDC_UNIT }, B: { weth: WETH_UNIT, usdc: 1n } },
      10,
      EXECUTOR,
    );
    expect(steps.every((step) => step.priceA === 2_000n * USDC_UNIT)).toBe(true);
  });

  it("keeps only the newest steps", () => {
    const steps = buildPriceSteps(groupByTransaction([...userSwapLogs, ...arbitrageLogs]), undefined, 2, EXECUTOR);
    expect(steps.map((step) => step.txHash)).toEqual([tx(1), tx(2)]);
  });

  it("returns no steps when nothing happened", () => {
    const empty: PoolTx[] = [];
    expect(buildPriceSteps(empty, undefined, 10, EXECUTOR)).toEqual([]);
  });
});

describe("priceScale", () => {
  it("puts the highest price at the top and the lowest at the bottom", () => {
    const scale = priceScale([3_000n * USDC_UNIT, 3_060n * USDC_UNIT]);
    expect(scale.y(3_060n * USDC_UNIT)).toBeLessThan(scale.y(3_000n * USDC_UNIT));
    expect(scale.y(3_000n * USDC_UNIT)).toBeLessThanOrEqual(1);
    expect(scale.y(3_060n * USDC_UNIT)).toBeGreaterThanOrEqual(0);
  });

  it("gives flat prices some room instead of dividing by zero", () => {
    const scale = priceScale([3_000n * USDC_UNIT]);
    expect(scale.y(3_000n * USDC_UNIT)).toBeCloseTo(0.5);
    expect(scale.max).toBeGreaterThan(scale.min);
  });

  it("stays usable when no price is known", () => {
    const scale = priceScale([0n]);
    expect(scale.y(3_000n * USDC_UNIT)).toBe(0.5);
    expect(Number.isFinite(scale.max)).toBe(true);
  });

  it("keeps wild swings readable on a log scale", () => {
    const scale = priceScale([30n * USDC_UNIT, 3_000n * USDC_UNIT, 300_000n * USDC_UNIT]);
    expect(scale.y(3_000n * USDC_UNIT)).toBeCloseTo(0.5, 1);
  });
});
