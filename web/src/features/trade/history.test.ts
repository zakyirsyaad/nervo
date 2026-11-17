import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { buildLoops, buildPriceSteps, groupByTransaction, mergeLogs, summarizeLoops, toPoolLog, type PoolLog } from "./history";

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

describe("buildLoops", () => {
  const NOW = 59_977_000;

  it("pairs a swap with the contract's trade that answered it, with the time between them", () => {
    const [row] = buildLoops(groupByTransaction([...userSwapLogs, ...arbitrageLogs]), undefined, EXECUTOR, NOW);
    expect(row.verdict).toBe("answered");
    expect(row.change).toMatchObject({ kind: "swap", actor: TRADER, txHash: tx(1) });
    expect(row.answer).toMatchObject({ buyPool: "A", sellPool: "B", usdcIn: 1_000n * USDC_UNIT, profit: 6_636_917n, afterMs: 1_600 });
    // The swap opened a gap of about 2%; the fixed 1,000 USDC trade narrowed it without closing it fully.
    expect(row.gapAfterChange).toBeGreaterThan(190);
    expect(row.gapAfterAnswer).toBeGreaterThan(0);
    expect(row.gapAfterAnswer).toBeLessThan(row.gapAfterChange ?? 0);
  });

  it("says no trade was due when the gap could not pay the fees", () => {
    const small: PoolLog[] = [
      reserves("B", tx(5), 300n, 0, 100n * WETH_UNIT - 3_323_000_000_000_000n, 300_010n * USDC_UNIT, TRADER),
      swap("B", tx(5), 300n, 1, TRADER, false, 10n * USDC_UNIT, 3_323_000_000_000_000n),
    ];
    const live = { A: { weth: 100n * WETH_UNIT, usdc: 300_000n * USDC_UNIT } };
    expect(buildLoops(groupByTransaction(small), live, EXECUTOR, 1_000)[0].verdict).toBe("too-small");
  });

  it("waits for a trade for a minute, then says none came", () => {
    const txs = groupByTransaction(userSwapLogs);
    const swapTime = 59_976_868;
    expect(buildLoops(txs, undefined, EXECUTOR, swapTime + 30)[0].verdict).toBe("waiting");
    expect(buildLoops(txs, undefined, EXECUTOR, swapTime + 120)[0].verdict).toBe("no-trade");
  });

  it("keeps a trade with no change before it in the window as its own row", () => {
    const [row] = buildLoops(groupByTransaction(arbitrageLogs), undefined, EXECUTOR, NOW);
    expect(row).toMatchObject({ change: null, verdict: "unprompted" });
    expect(row.answer?.afterMs).toBeUndefined();
  });

  it("describes a reserve change without a swap as a reset, with the price it set", () => {
    const reset = groupByTransaction([reserves("A", tx(7), 200n, 0, 100n * WETH_UNIT, 300_000n * USDC_UNIT, OWNER)]);
    const [row] = buildLoops(reset, undefined, EXECUTOR, NOW);
    expect(row.change).toMatchObject({ kind: "reset", actor: OWNER, resetPrices: { A: 3_000n * USDC_UNIT } });
  });

  it("lists the newest change first", () => {
    const later = [reserves("A", tx(8), 59_990_000n, 0, 100n * WETH_UNIT, 300_000n * USDC_UNIT, OWNER)];
    const rows = buildLoops(groupByTransaction([...userSwapLogs, ...arbitrageLogs, ...later]), undefined, EXECUTOR, NOW);
    expect(rows.map((row) => row.key)).toEqual([tx(8), tx(1)]);
  });
});

describe("summarizeLoops", () => {
  it("counts answered changes and reports the middle and fastest answer times", () => {
    const answered = (afterMs: number) => ({
      key: String(afterMs),
      change: null,
      answer: { afterMs } as never,
      gapAfterChange: null,
      gapAfterAnswer: null,
      verdict: "answered" as const,
    });
    expect(summarizeLoops([answered(1_800), answered(1_600), answered(3_600)])).toEqual({ answered: 3, typicalMs: 1_800, fastestMs: 1_600 });
    expect(summarizeLoops([])).toEqual({ answered: 0, typicalMs: undefined, fastestMs: undefined });
  });
});

describe("buildPriceSteps", () => {
  it("gives both prices after each transaction, carrying the untouched pool forward", () => {
    const steps = buildPriceSteps(groupByTransaction([...userSwapLogs, ...arbitrageLogs]), undefined, 10, EXECUTOR);
    expect(steps.map((step) => step.txHash)).toEqual([tx(1), tx(2)]);
    expect(steps[0]).toMatchObject({ byContract: false, hasSwap: true, priceA: 3_000n * USDC_UNIT });
    expect(steps[0].priceB).toBeGreaterThan(3_000n * USDC_UNIT);
    expect(steps[1]).toMatchObject({ byContract: true });
    expect(steps.map((step) => step.touches)).toEqual([["B"], ["A", "B"]]);
  });

  it("uses the live reserves for a pool that did not change in the window", () => {
    const steps = buildPriceSteps(
      groupByTransaction(userSwapLogs),
      { A: { weth: WETH_UNIT, usdc: 2_000n * USDC_UNIT }, B: { weth: WETH_UNIT, usdc: 1n } },
      10,
      EXECUTOR,
    );
    expect(steps[0].priceA).toBe(2_000n * USDC_UNIT);
  });

  it("keeps only the newest steps", () => {
    const steps = buildPriceSteps(groupByTransaction([...userSwapLogs, ...arbitrageLogs]), undefined, 1, EXECUTOR);
    expect(steps.map((step) => step.txHash)).toEqual([tx(2)]);
  });
});
