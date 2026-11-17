// Recent pool history for the trade page: who changed which pool, and what both prices were after each change.
// Everything here is pure; useHistory reads the logs from Base Sepolia.

import type { Address, Hex } from "viem";
import { BASE_SEPOLIA_BLOCK_TIME_MS } from "@/config/chains";
import { spotPriceUsdc, type Reserves, type TokenSymbol } from "@/lib/amm";

export type PoolKey = "A" | "B";

export const POOL_KEYS: readonly PoolKey[] = ["A", "B"];

// The executor drops a callback older than 60 seconds, so a trade never answers a change older than that.
const FOLLOW_UP_WINDOW_BLOCKS = 300n;

interface LogPosition {
  readonly pool: PoolKey;
  readonly txHash: Hex;
  readonly blockNumber: bigint;
  readonly logIndex: number;
}

export interface SwapLog extends LogPosition {
  readonly kind: "swap";
  readonly sender: Address;
  readonly wethIn: boolean;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
}

export interface ReservesLog extends LogPosition {
  readonly kind: "reserves";
  readonly initiator: Address;
  readonly reserves: Reserves;
  /** Block time in seconds, as the pool recorded it. */
  readonly timestamp: number;
}

export type PoolLog = SwapLog | ReservesLog;

/** The fields of a viem log this module reads. */
export interface RawPoolLog {
  readonly address: Address;
  readonly eventName: "Swap" | "ReserveUpdate";
  readonly args: {
    readonly sender?: Address;
    readonly tokenIn?: Address;
    readonly recipient?: Address;
    readonly amountIn?: bigint;
    readonly amountOut?: bigint;
    readonly initiator?: Address;
    readonly reserveWeth?: bigint;
    readonly reserveUsdc?: bigint;
    readonly sequence?: bigint;
    readonly timestamp?: bigint;
  };
  readonly transactionHash: Hex | null;
  readonly blockNumber: bigint | null;
  readonly logIndex: number | null;
}

export function sameAddress(left: string | undefined, right: string | undefined): boolean {
  return left !== undefined && right !== undefined && left.toLowerCase() === right.toLowerCase();
}

/** Decodes one pool log. Null for pending logs, other contracts, or missing fields. */
export function toPoolLog(log: RawPoolLog, pools: Readonly<Record<PoolKey, Address>>, weth: Address): PoolLog | null {
  const pool = POOL_KEYS.find((key) => sameAddress(pools[key], log.address));
  if (!pool || log.transactionHash === null || log.blockNumber === null || log.logIndex === null) return null;
  const position = { pool, txHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex };
  const { args } = log;

  if (log.eventName === "Swap") {
    if (!args.sender || !args.tokenIn || args.amountIn === undefined || args.amountOut === undefined) return null;
    return { kind: "swap", ...position, sender: args.sender, wethIn: sameAddress(args.tokenIn, weth), amountIn: args.amountIn, amountOut: args.amountOut };
  }
  if (!args.initiator || args.reserveWeth === undefined || args.reserveUsdc === undefined || args.timestamp === undefined) return null;
  return {
    kind: "reserves",
    ...position,
    initiator: args.initiator,
    reserves: { weth: args.reserveWeth, usdc: args.reserveUsdc },
    timestamp: Number(args.timestamp),
  };
}

function compareLogs(left: PoolLog, right: PoolLog): number {
  if (left.blockNumber !== right.blockNumber) return left.blockNumber < right.blockNumber ? -1 : 1;
  return left.logIndex - right.logIndex;
}

/** Adds freshly read logs to the ones already known: one copy each, oldest first, none before `windowStart`. */
export function mergeLogs(known: readonly PoolLog[], fresh: readonly PoolLog[], windowStart: bigint): PoolLog[] {
  const byPosition = new Map<string, PoolLog>();
  for (const log of [...known, ...fresh]) {
    if (log.blockNumber >= windowStart) byPosition.set(`${log.txHash}:${log.logIndex}`, log);
  }
  return [...byPosition.values()].sort(compareLogs);
}

export interface SwapLeg {
  readonly pool: PoolKey;
  readonly sender: Address;
  readonly wethIn: boolean;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
}

/** One transaction that changed at least one pool. */
export interface PoolTx {
  readonly txHash: Hex;
  readonly blockNumber: bigint;
  /** Block time in seconds. */
  readonly timestamp: number | undefined;
  /** Who sent the swaps, or who changed the reserves when there was no swap. */
  readonly actor: Address;
  readonly swaps: readonly SwapLeg[];
  /** Reserves each touched pool ended the transaction with. */
  readonly after: Partial<Record<PoolKey, Reserves>>;
  /** Reserves before the transaction, for pools whose single swap lets us work them out. */
  readonly before: Partial<Record<PoolKey, Reserves>>;
}

function reservesBeforeSwap(after: Reserves, swap: SwapLog): Reserves {
  return swap.wethIn
    ? { weth: after.weth - swap.amountIn, usdc: after.usdc + swap.amountOut }
    : { weth: after.weth + swap.amountOut, usdc: after.usdc - swap.amountIn };
}

function toPoolTx(logs: readonly PoolLog[]): PoolTx {
  const swaps = logs.filter((log): log is SwapLog => log.kind === "swap");
  const updates = logs.filter((log): log is ReservesLog => log.kind === "reserves");
  const after: Partial<Record<PoolKey, Reserves>> = {};
  const before: Partial<Record<PoolKey, Reserves>> = {};

  for (const pool of POOL_KEYS) {
    const poolUpdates = updates.filter((log) => log.pool === pool);
    const poolSwaps = swaps.filter((log) => log.pool === pool);
    const last = poolUpdates.at(-1);
    if (last) after[pool] = last.reserves;
    if (poolUpdates.length === 1 && poolSwaps.length === 1) before[pool] = reservesBeforeSwap(poolUpdates[0].reserves, poolSwaps[0]);
  }

  return {
    txHash: logs[0].txHash,
    blockNumber: logs[0].blockNumber,
    timestamp: updates[0]?.timestamp,
    actor: swaps[0]?.sender ?? updates[0]?.initiator ?? "0x0000000000000000000000000000000000000000",
    swaps: swaps.map(({ pool, sender, wethIn, amountIn, amountOut }) => ({ pool, sender, wethIn, amountIn, amountOut })),
    after,
    before,
  };
}

/** Groups logs by transaction, oldest first. */
export function groupByTransaction(logs: readonly PoolLog[]): PoolTx[] {
  const byTx = new Map<Hex, PoolLog[]>();
  for (const log of [...logs].sort(compareLogs)) {
    byTx.set(log.txHash, [...(byTx.get(log.txHash) ?? []), log]);
  }
  return [...byTx.values()].map(toPoolTx);
}

interface EntryBase {
  readonly key: string;
  readonly txHash: Hex;
  readonly blockNumber: bigint;
  readonly timestamp: number | undefined;
}

export interface ArbitrageEntry extends EntryBase {
  readonly kind: "arbitrage";
  readonly buyPool: PoolKey;
  readonly sellPool: PoolKey;
  readonly weth: bigint;
  readonly usdcIn: bigint;
  readonly usdcOut: bigint;
  readonly profit: bigint;
  /** Time since the last change by anyone else, when that change came within the callback deadline. */
  readonly sincePreviousMs: number | undefined;
}

export interface TokenAmount {
  readonly token: TokenSymbol;
  readonly amount: bigint;
}

export interface SwapEntry extends EntryBase {
  readonly kind: "swap";
  readonly actor: Address;
  readonly pool: PoolKey;
  readonly paid: TokenAmount;
  readonly received: TokenAmount;
}

export interface ResetEntry extends EntryBase {
  readonly kind: "reset";
  readonly actor: Address;
  readonly pools: readonly PoolKey[];
  readonly prices: Partial<Record<PoolKey, bigint>>;
}

export type ActivityEntry = ArbitrageEntry | SwapEntry | ResetEntry;

function followUpMs(txs: readonly PoolTx[], index: number, executor: Address): number | undefined {
  const trade = txs[index];
  for (let earlier = index - 1; earlier >= 0; earlier -= 1) {
    const candidate = txs[earlier];
    if (trade.blockNumber - candidate.blockNumber > FOLLOW_UP_WINDOW_BLOCKS) return undefined;
    if (!sameAddress(candidate.actor, executor)) return Number(trade.blockNumber - candidate.blockNumber) * BASE_SEPOLIA_BLOCK_TIME_MS;
  }
  return undefined;
}

function entriesFor(txs: readonly PoolTx[], index: number, executor: Address): ActivityEntry[] {
  const tx = txs[index];
  const base = { txHash: tx.txHash, blockNumber: tx.blockNumber, timestamp: tx.timestamp };
  const [buy, sell] = tx.swaps;
  const isRoundTrip = tx.swaps.length === 2 && !buy.wethIn && sell.wethIn;

  if (sameAddress(tx.actor, executor) && isRoundTrip) {
    return [
      {
        ...base,
        key: tx.txHash,
        kind: "arbitrage",
        buyPool: buy.pool,
        sellPool: sell.pool,
        weth: buy.amountOut,
        usdcIn: buy.amountIn,
        usdcOut: sell.amountOut,
        profit: sell.amountOut - buy.amountIn,
        sincePreviousMs: followUpMs(txs, index, executor),
      },
    ];
  }

  if (tx.swaps.length > 0) {
    return tx.swaps
      .map((leg, legIndex): SwapEntry => ({
        ...base,
        key: `${tx.txHash}:${legIndex}`,
        kind: "swap",
        actor: leg.sender,
        pool: leg.pool,
        paid: { token: leg.wethIn ? "weth" : "usdc", amount: leg.amountIn },
        received: { token: leg.wethIn ? "usdc" : "weth", amount: leg.amountOut },
      }))
      .reverse();
  }

  const pools = POOL_KEYS.filter((pool) => tx.after[pool] !== undefined);
  const prices = Object.fromEntries(pools.map((pool) => [pool, spotPriceUsdc(tx.after[pool] as Reserves)]));
  return [{ ...base, key: tx.txHash, kind: "reset", actor: tx.actor, pools, prices }];
}

/** Newest-first activity: the contract's round trips as one trade each, other swaps, and owner resets. */
export function buildActivity(txs: readonly PoolTx[], executor: Address, limit: number): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  for (let index = txs.length - 1; index >= 0 && entries.length < limit; index -= 1) {
    entries.push(...entriesFor(txs, index, executor));
  }
  return entries.slice(0, limit);
}

export interface PriceStep {
  readonly key: string;
  /** Null for the starting point, before the first transaction shown. */
  readonly txHash: Hex | null;
  readonly timestamp: number | undefined;
  /** Who made the change; null for the starting point. */
  readonly actor: Address | null;
  readonly hasSwap: boolean;
  readonly byContract: boolean;
  readonly priceA: bigint | null;
  readonly priceB: bigint | null;
}

function startingReserves(txs: readonly PoolTx[], pool: PoolKey, live: Partial<Record<PoolKey, Reserves>> | undefined): Reserves | undefined {
  const first = txs.find((tx) => tx.after[pool] !== undefined);
  return first ? first.before[pool] : live?.[pool];
}

function priceOf(reserves: Reserves | undefined): bigint | null {
  return reserves ? spotPriceUsdc(reserves) : null;
}

/**
 * Both pool prices after each transaction, oldest first, ending with the newest `maxSteps`. The first step is the
 * state before the window when it can be worked out. A pool that did not change uses its live reserves throughout.
 */
export function buildPriceSteps(
  txs: readonly PoolTx[],
  live: Partial<Record<PoolKey, Reserves>> | undefined,
  maxSteps: number,
  executor: Address,
): PriceStep[] {
  if (txs.length === 0) return [];
  let state: Partial<Record<PoolKey, Reserves>> = { A: startingReserves(txs, "A", live), B: startingReserves(txs, "B", live) };
  const steps: PriceStep[] = [
    {
      key: "start",
      txHash: null,
      timestamp: undefined,
      actor: null,
      hasSwap: false,
      byContract: false,
      priceA: priceOf(state.A),
      priceB: priceOf(state.B),
    },
  ];
  for (const tx of txs) {
    state = { ...state, ...tx.after };
    steps.push({
      key: tx.txHash,
      txHash: tx.txHash,
      timestamp: tx.timestamp,
      actor: tx.actor,
      hasSwap: tx.swaps.length > 0,
      byContract: sameAddress(tx.actor, executor),
      priceA: priceOf(state.A),
      priceB: priceOf(state.B),
    });
  }
  return steps.slice(-maxSteps);
}

export interface PriceScale {
  readonly min: number;
  readonly max: number;
  /** Vertical position from 0 (top) to 1 (bottom). */
  readonly y: (price: bigint) => number;
}

// Room above and below the lines, as a share of the plotted range.
const SCALE_PADDING = 0.08;
// Half-height of the range when every price is the same, as a ratio (1%).
const FLAT_HALF_RANGE = Math.log(1.01);

/** Log scale over the given prices, so a 1% gap and a 100x swing both stay readable. */
export function priceScale(prices: readonly bigint[]): PriceScale {
  const logs = prices.filter((price) => price > 0n).map((price) => Math.log(Number(price)));
  if (logs.length === 0) return { min: 0, max: 0, y: () => 0.5 };
  const low = Math.min(...logs);
  const high = Math.max(...logs);
  const span = high - low;
  const pad = span > 0 ? span * SCALE_PADDING : FLAT_HALF_RANGE;
  const bottom = low - pad;
  const top = high + pad;
  return {
    min: Math.exp(bottom),
    max: Math.exp(top),
    y: (price) => (price > 0n ? (top - Math.log(Number(price))) / (top - bottom) : 1),
  };
}
