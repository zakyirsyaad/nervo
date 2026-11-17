// Recent pool history for the trade page: who changed which pool, and what both prices were after each change.
// Everything here is pure; useHistory reads the logs from Base Sepolia.

import type { Address, Hex } from "viem";
import { OUTCOMES, type Outcome } from "@/config/abis";
import { BASE_SEPOLIA_BLOCK_TIME_MS } from "@/config/chains";
import { ARB_INPUT_USDC, MIN_SURPLUS_USDC, POOL_FEE_BPS } from "@/config/contracts";
import { bestRoute, gapBps, spotPriceUsdc, type Reserves } from "@/lib/amm";
import { opportunityId } from "@/lib/opportunity";

export type PoolKey = "A" | "B";

export const POOL_KEYS: readonly PoolKey[] = ["A", "B"];

// The executor drops a callback older than 60 seconds, so a trade never answers a change older than that.
const FOLLOW_UP_WINDOW_SECONDS = 60;

interface LogAt {
  readonly txHash: Hex;
  readonly blockNumber: bigint;
  readonly logIndex: number;
}

interface LogPosition extends LogAt {
  readonly pool: PoolKey;
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
  /** The id ArbReactive gives the opportunity this log starts, keccak256(abi.encode(chainId, pool, tx, index)). */
  readonly opportunityId: Hex;
}

/** ArbExecutor's record of what it did with one callback, keyed by the opportunity that asked for it. */
export interface OutcomeLog extends LogAt {
  readonly kind: "outcome";
  readonly opportunityId: Hex;
  readonly outcome: Outcome;
}

export type PoolLog = SwapLog | ReservesLog | OutcomeLog;

/** The fields of a viem log this module reads. */
export interface RawPoolLog {
  readonly address: Address;
  readonly eventName: "Swap" | "ReserveUpdate" | "ArbOutcome";
  readonly args: {
    readonly opportunityId?: Hex;
    readonly outcome?: number;
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

export interface LogSources {
  readonly chainId: number;
  readonly pools: Readonly<Record<PoolKey, Address>>;
  readonly weth: Address;
  readonly executor: Address;
}

/** Decodes one pool or executor log. Null for pending logs, other contracts, or missing fields. */
export function toPoolLog(log: RawPoolLog, { chainId, pools, weth, executor }: LogSources): PoolLog | null {
  if (log.transactionHash === null || log.blockNumber === null || log.logIndex === null) return null;
  const at = { txHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex };
  const { args } = log;

  if (log.eventName === "ArbOutcome") {
    const outcome = args.outcome === undefined ? undefined : OUTCOMES[args.outcome];
    if (!sameAddress(log.address, executor) || !args.opportunityId || !outcome) return null;
    return { kind: "outcome", ...at, opportunityId: args.opportunityId, outcome };
  }

  const pool = POOL_KEYS.find((key) => sameAddress(pools[key], log.address));
  if (!pool) return null;
  const position = { pool, ...at };

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
    opportunityId: opportunityId({ chainId, pool: pools[pool], txHash: at.txHash, logIndex: at.logIndex }),
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
  /** Opportunities this transaction's reserve changes start, one per ReserveUpdate. */
  readonly opportunityIds: readonly Hex[];
  /** What the executor did with each callback it handled in this transaction. */
  readonly outcomes: readonly { readonly opportunityId: Hex; readonly outcome: Outcome }[];
}

function reservesBeforeSwap(after: Reserves, swap: SwapLog): Reserves {
  return swap.wethIn
    ? { weth: after.weth - swap.amountIn, usdc: after.usdc + swap.amountOut }
    : { weth: after.weth + swap.amountOut, usdc: after.usdc - swap.amountIn };
}

function toPoolTx(logs: readonly PoolLog[]): PoolTx {
  const swaps = logs.filter((log): log is SwapLog => log.kind === "swap");
  const updates = logs.filter((log): log is ReservesLog => log.kind === "reserves");
  const outcomes = logs.filter((log): log is OutcomeLog => log.kind === "outcome");
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
    opportunityIds: updates.map((log) => log.opportunityId),
    outcomes: outcomes.map(({ opportunityId: id, outcome }) => ({ opportunityId: id, outcome })),
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

/** A transaction that changed the pools, other than the contract's own trade. */
export interface Change {
  readonly txHash: Hex;
  readonly blockNumber: bigint;
  readonly timestamp: number | undefined;
  readonly actor: Address;
  readonly kind: "swap" | "reset";
  readonly swaps: readonly SwapLeg[];
  /** Pools a reset set, with the price each was set to. */
  readonly resetPrices: Partial<Record<PoolKey, bigint>>;
}

/** The contract's round trip: buy WETH on one pool, sell it on the other, in one transaction. */
export interface Answer {
  readonly txHash: Hex;
  readonly blockNumber: bigint;
  readonly buyPool: PoolKey;
  readonly sellPool: PoolKey;
  readonly weth: bigint;
  readonly usdcIn: bigint;
  readonly usdcOut: bigint;
  readonly profit: bigint;
  /** Time from the change it answered, from block numbers; undefined when it answered nothing we saw. */
  readonly afterMs: number | undefined;
}

/**
 * answered: the contract traded for this change. skipped: the contract's callback for it arrived and it chose not to
 * trade. too-small: the gap could not pay the fees plus the 2 USDC floor, so no trade was due. waiting: a trade may
 * still come. no-trade: nothing came within the callback deadline. unprompted: a trade whose change is outside the
 * window.
 */
export type Verdict = "answered" | "skipped" | "too-small" | "waiting" | "no-trade" | "unprompted";

export interface LoopRow {
  readonly key: string;
  readonly change: Change | null;
  readonly answer: Answer | null;
  /** Why the contract did not trade, when its callback for this change arrived and it skipped. */
  readonly skipped: Outcome | null;
  /** Pool B against Pool A in basis points, right after the change and right after the answer. */
  readonly gapAfterChange: number | null;
  readonly gapAfterAnswer: number | null;
  readonly verdict: Verdict;
}

type PoolState = Partial<Record<PoolKey, Reserves>>;

function startingReserves(txs: readonly PoolTx[], pool: PoolKey, live: PoolState | undefined): Reserves | undefined {
  const first = txs.find((tx) => tx.after[pool] !== undefined);
  return first ? first.before[pool] : live?.[pool];
}

/** Reserves of both pools before the first transaction and after each one. */
function replay(txs: readonly PoolTx[], live: PoolState | undefined): { start: PoolState; after: PoolState[] } {
  const start: PoolState = { A: startingReserves(txs, "A", live), B: startingReserves(txs, "B", live) };
  const after: PoolState[] = [];
  let state = start;
  for (const tx of txs) {
    state = { ...state, ...tx.after };
    after.push(state);
  }
  return { start, after };
}

function gapOf(state: PoolState): number | null {
  if (!state.A || !state.B) return null;
  return gapBps(spotPriceUsdc(state.B), spotPriceUsdc(state.A));
}

/** The contract's own rule: a 1,000 USDC round trip must come back with at least 2 USDC more. */
function isTradable(state: PoolState): boolean | null {
  if (!state.A || !state.B) return null;
  return bestRoute(ARB_INPUT_USDC, state.A, state.B, POOL_FEE_BPS).usdcOut >= ARB_INPUT_USDC + MIN_SURPLUS_USDC;
}

function toAnswer(tx: PoolTx, changeBlock: bigint | undefined): Answer {
  const [buy, sell] = tx.swaps;
  return {
    txHash: tx.txHash,
    blockNumber: tx.blockNumber,
    buyPool: buy.pool,
    sellPool: sell.pool,
    weth: buy.amountOut,
    usdcIn: buy.amountIn,
    usdcOut: sell.amountOut,
    profit: sell.amountOut - buy.amountIn,
    afterMs: changeBlock === undefined ? undefined : Number(tx.blockNumber - changeBlock) * BASE_SEPOLIA_BLOCK_TIME_MS,
  };
}

function toChange(tx: PoolTx): Change {
  const isReset = tx.swaps.length === 0;
  const resetPrices = isReset
    ? Object.fromEntries(POOL_KEYS.filter((pool) => tx.after[pool]).map((pool) => [pool, spotPriceUsdc(tx.after[pool] as Reserves)]))
    : {};
  return {
    txHash: tx.txHash,
    blockNumber: tx.blockNumber,
    timestamp: tx.timestamp,
    actor: tx.actor,
    kind: isReset ? "reset" : "swap",
    swaps: tx.swaps,
    resetPrices,
  };
}

function isRoundTrip(tx: PoolTx, executor: Address): boolean {
  const [buy, sell] = tx.swaps;
  return sameAddress(tx.actor, executor) && tx.swaps.length === 2 && !buy.wethIn && sell.wethIn;
}

/** True when the transaction changed a pool's reserves (an executor skip changes nothing). */
function changesReserves(tx: PoolTx): boolean {
  return POOL_KEYS.some((pool) => tx.after[pool] !== undefined);
}

interface OpenRow {
  readonly change: Change | null;
  readonly answer: Answer | null;
  readonly skipped: Outcome | null;
  readonly gapAfterChange: number | null;
  readonly gapAfterAnswer: number | null;
  readonly tradable: boolean | null;
}

function verdictOf(row: OpenRow, nowSeconds: number): Verdict {
  if (row.answer) return row.change ? "answered" : "unprompted";
  if (row.skipped) return "skipped";
  if (row.tradable === false) return "too-small";
  const age = row.change?.timestamp === undefined ? Infinity : nowSeconds - row.change.timestamp;
  return age <= FOLLOW_UP_WINDOW_SECONDS ? "waiting" : "no-trade";
}

/**
 * Pairs every change with what the contract did about it, newest first. The pairing follows ids, not order: the
 * executor's ArbOutcome names the opportunity it handled, which is the ReserveUpdate log that started it.
 */
export function buildLoops(txs: readonly PoolTx[], live: PoolState | undefined, executor: Address, nowSeconds: number): LoopRow[] {
  const { after } = replay(txs, live);
  const rows: OpenRow[] = [];
  const rowByOpportunity = new Map<Hex, number>();

  txs.forEach((tx, index) => {
    if (changesReserves(tx) && !isRoundTrip(tx, executor)) {
      const rowIndex =
        rows.push({
          change: toChange(tx),
          answer: null,
          skipped: null,
          gapAfterChange: gapOf(after[index]),
          gapAfterAnswer: null,
          tradable: isTradable(after[index]),
        }) - 1;
      for (const id of tx.opportunityIds) rowByOpportunity.set(id, rowIndex);
      return;
    }

    if (isRoundTrip(tx, executor)) {
      const executed = tx.outcomes.find((item) => item.outcome === "Executed");
      const source = executed ? rowByOpportunity.get(executed.opportunityId) : undefined;
      const row = source === undefined ? undefined : rows[source];
      if (source !== undefined && row && !row.answer) {
        rows[source] = { ...row, answer: toAnswer(tx, row.change?.blockNumber), gapAfterAnswer: gapOf(after[index]) };
        return;
      }
      rows.push({ change: null, answer: toAnswer(tx, undefined), skipped: null, gapAfterChange: null, gapAfterAnswer: gapOf(after[index]), tradable: null });
      return;
    }

    // A callback that arrived and did not trade: it changed nothing, but says which change it was for.
    for (const item of tx.outcomes) {
      const source = rowByOpportunity.get(item.opportunityId);
      const row = source === undefined ? undefined : rows[source];
      if (source !== undefined && row && !row.answer && !row.skipped) rows[source] = { ...row, skipped: item.outcome };
    }
  });

  return rows
    .map((row) => ({
      key: row.change?.txHash ?? row.answer?.txHash ?? "",
      change: row.change,
      answer: row.answer,
      skipped: row.skipped,
      gapAfterChange: row.gapAfterChange,
      gapAfterAnswer: row.gapAfterAnswer,
      verdict: verdictOf(row, nowSeconds),
    }))
    .reverse();
}

export interface LoopSummary {
  readonly answered: number;
  readonly typicalMs: number | undefined;
  readonly fastestMs: number | undefined;
}

/** How many changes the contract answered and how fast, over every row given. */
export function summarizeLoops(rows: readonly LoopRow[]): LoopSummary {
  const times = rows.flatMap((row) => (row.verdict === "answered" && row.answer?.afterMs !== undefined ? [row.answer.afterMs] : []));
  const sorted = [...times].sort((left, right) => left - right);
  return {
    answered: times.length,
    typicalMs: sorted.length > 0 ? sorted[Math.floor((sorted.length - 1) / 2)] : undefined,
    fastestMs: sorted[0],
  };
}

export interface PriceStep {
  readonly key: string;
  readonly txHash: Hex;
  readonly timestamp: number | undefined;
  readonly actor: Address;
  readonly hasSwap: boolean;
  readonly byContract: boolean;
  /** Pools whose reserves this transaction changed. */
  readonly touches: readonly PoolKey[];
  readonly priceA: bigint | null;
  readonly priceB: bigint | null;
}

function priceOf(reserves: Reserves | undefined): bigint | null {
  return reserves ? spotPriceUsdc(reserves) : null;
}

/** Both pool prices after each transaction, oldest first, ending with the newest `maxSteps`. */
export function buildPriceSteps(txs: readonly PoolTx[], live: PoolState | undefined, maxSteps: number, executor: Address): PriceStep[] {
  const { after } = replay(txs, live);
  return txs
    .map((tx, index) => ({
      key: tx.txHash,
      txHash: tx.txHash,
      timestamp: tx.timestamp,
      actor: tx.actor,
      hasSwap: tx.swaps.length > 0,
      byContract: sameAddress(tx.actor, executor),
      touches: POOL_KEYS.filter((pool) => tx.after[pool] !== undefined),
      priceA: priceOf(after[index].A),
      priceB: priceOf(after[index].B),
    }))
    .filter((step) => step.touches.length > 0)
    .slice(-maxSteps);
}
