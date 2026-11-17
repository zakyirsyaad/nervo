// Every order on the book, not only the connected wallet's: what fired it on Base and how long the fill took.
// Pure; useOrderBook reads the logs and the orders.

import type { Hex } from "viem";
import type { OrderOutcome } from "@/config/orderAbis";
import type { PriceStep } from "@/features/trade/history";
import type { OrderView } from "./orderList";
import { latencySeconds } from "./trail";

export interface BookOutcome {
  readonly orderId: bigint;
  readonly outcome: OrderOutcome;
  readonly amountOut: bigint;
  readonly observedPrice: bigint;
  /** Base Sepolia block time of the price that fired the order, in seconds. */
  readonly sourceTimestamp: bigint;
  /** Unichain Sepolia block time of the outcome, in seconds. */
  readonly timestamp: bigint;
  readonly txHash: Hex;
  readonly blockNumber: bigint;
  readonly logIndex: number;
}

export interface BookRow {
  readonly view: OrderView;
  /** The order's latest outcome, if the contract has acted on it. */
  readonly outcome: BookOutcome | undefined;
  /** Whole seconds from the Base price to the Unichain fill, for filled orders. */
  readonly fillSeconds: number | undefined;
}

function isLater(left: BookOutcome, right: BookOutcome): boolean {
  if (left.blockNumber !== right.blockNumber) return left.blockNumber > right.blockNumber;
  return left.logIndex > right.logIndex;
}

/** Which outcome a row shows: a fill always, since a later callback for the same order can only be a skip. */
function outranks(outcome: BookOutcome, known: BookOutcome): boolean {
  const isFill = outcome.outcome === "Filled";
  const knownIsFill = known.outcome === "Filled";
  if (isFill !== knownIsFill) return isFill;
  return isLater(outcome, known);
}

/** One row per order, newest first, each with its fill or else its latest outcome. */
export function buildBookRows(views: readonly OrderView[], outcomes: readonly BookOutcome[]): BookRow[] {
  const latest = new Map<bigint, BookOutcome>();
  for (const outcome of outcomes) {
    const known = latest.get(outcome.orderId);
    if (!known || outranks(outcome, known)) latest.set(outcome.orderId, outcome);
  }
  return [...views]
    .sort((left, right) => (left.ref.id === right.ref.id ? 0 : left.ref.id > right.ref.id ? -1 : 1))
    .map((view) => {
      const outcome = latest.get(view.ref.id);
      return { view, outcome, fillSeconds: outcome?.outcome === "Filled" ? latencySeconds(outcome) : undefined };
    });
}

export interface BookSummary {
  /** Orders the contract acted on, and how many of them filled. */
  readonly fired: number;
  readonly filled: number;
  readonly typicalSeconds: number | undefined;
  readonly fastestSeconds: number | undefined;
}

export function summarizeBook(rows: readonly BookRow[]): BookSummary {
  const seconds = rows.flatMap((row) => (row.fillSeconds === undefined ? [] : [row.fillSeconds])).sort((a, b) => a - b);
  return {
    fired: rows.filter((row) => row.outcome !== undefined).length,
    filled: seconds.length,
    typicalSeconds: seconds.length > 0 ? seconds[Math.floor((seconds.length - 1) / 2)] : undefined,
    fastestSeconds: seconds[0],
  };
}

/**
 * Which Base Pool A changes fired which orders: an outcome names the second and the price it saw, and the change
 * to Pool A in that second with the closest price is the one. Keys are price-step keys.
 */
export function firedSteps(steps: readonly PriceStep[], outcomes: readonly BookOutcome[]): Map<string, bigint[]> {
  const fired = new Map<string, bigint[]>();
  for (const outcome of outcomes) {
    const candidates = steps.filter(
      (step) => step.touches.includes("A") && step.priceA !== null && step.timestamp === Number(outcome.sourceTimestamp),
    );
    if (candidates.length === 0) continue;
    const distance = (step: PriceStep) => {
      const gap = (step.priceA ?? 0n) - outcome.observedPrice;
      return gap < 0n ? -gap : gap;
    };
    const best = candidates.reduce((left, right) => (distance(right) < distance(left) ? right : left));
    fired.set(best.key, [...(fired.get(best.key) ?? []), outcome.orderId]);
  }
  return fired;
}
