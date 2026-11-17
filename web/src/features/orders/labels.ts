import type { MirrorReason, OrderOutcome, OrderStatus } from "@/config/orderAbis";
import { MAX_SLIPPAGE_RETRIES, MAX_TRIGGER_ATTEMPTS, MAX_WATCHED_PER_OWNER, MAX_WATCHED_TOTAL } from "@/config/orders";
import type { OrderKind } from "./kinds";

export type Tone = "ok" | "warn" | "danger" | "muted" | "accent";

export interface StatusBadge {
  readonly label: string;
  readonly tone: Tone;
}

const CLOSED_BADGE: Record<Exclude<OrderStatus, "Open">, StatusBadge> = {
  None: { label: "Not found", tone: "muted" },
  Filled: { label: "Filled", tone: "ok" },
  Cancelled: { label: "Cancelled", tone: "muted" },
  Expired: { label: "Expired, refunded", tone: "muted" },
};

/** Short status for the order list. An open order past its expiry still holds tokens until it is cancelled. */
export function orderStatusBadge(status: OrderStatus, isExpired: boolean): StatusBadge {
  if (status !== "Open") return CLOSED_BADGE[status];
  return isExpired ? { label: "Expired, cancel to refund", tone: "warn" } : { label: "Waiting for the price", tone: "accent" };
}

export interface OutcomeText {
  readonly title: string;
  readonly detail: string;
}

export const OUTCOME_TEXT: Record<OrderOutcome, OutcomeText> = {
  Filled: { title: "Filled", detail: "The order traded on Unichain's pool." },
  SkippedNotOpen: {
    title: "Nothing to do",
    detail: "The order was already closed when the trade arrived, so nothing happened.",
  },
  SkippedExpired: {
    title: "Expired, tokens returned",
    detail: "The order had passed its expiry when the price was reached, so your tokens were sent back.",
  },
  SkippedSlippage: {
    title: "Not filled yet",
    detail:
      "Unichain's pool would have paid less than your minimum, so nothing was traded. The order stays open and tries again on a later price change.",
  },
};

const CANCEL_HINT = "Your tokens are still in the order book: cancel the order to get your tokens back.";

/** What each reason the Reactive contract records means for the visitor. */
export const MIRROR_REASON_TEXT: Record<MirrorReason, string> = {
  Placed: "It checks every price change on Base Pool A against your trigger.",
  PlacedUntracked: `Not watched: the contract already watches as many orders as it can (${MAX_WATCHED_TOTAL} in total), so it will never trigger this one. ${CANCEL_HINT}`,
  Cancelled: "Stopped watching because you cancelled the order.",
  Filled: "Stopped watching because the order was filled.",
  Expired: `Stopped watching because the order passed its expiry. If it still shows as open, ${CANCEL_HINT.charAt(0).toLowerCase()}${CANCEL_HINT.slice(1)}`,
  NotOpen: "Stopped watching because the order was already closed.",
  Rearmed: "Watching again after a trade that did not go through.",
  NoChange: "Nothing changed.",
  OwnerLimit: `Not watched: this wallet already had ${MAX_WATCHED_PER_OWNER} orders being watched, the most per wallet, so this one will never trigger. ${CANCEL_HINT}`,
  RetryLimit: `No longer watched: Unichain's pool paid less than your minimum ${MAX_SLIPPAGE_RETRIES} times in a row, so it stopped trying. ${CANCEL_HINT}`,
  AttemptLimit: `No longer watched: the trade was sent ${MAX_TRIGGER_ATTEMPTS} times without filling, so it stopped trying. ${CANCEL_HINT}`,
};

const KIND_VERB: Record<OrderKind, (amount: string) => string> = {
  "stop-loss": (amount) => `Sell ${amount} if the price falls to`,
  "take-profit": (amount) => `Sell ${amount} if the price rises to`,
  "limit-buy": (amount) => `Buy WETH with ${amount} if the price falls to`,
};

/** One line describing an order, e.g. "Sell 0.5 WETH if the price falls to 2,970.00 USDC". */
export function orderSentence(kind: OrderKind | undefined, amount: string, trigger: string): string {
  if (!kind) return `Custom order of ${amount} at ${trigger} USDC`;
  return `${KIND_VERB[kind](amount)} ${trigger} USDC`;
}

/** Reasons that leave an order open in the order book but no longer watched. */
export const NOT_WATCHED_REASONS: readonly MirrorReason[] = [
  "PlacedUntracked",
  "OwnerLimit",
  "Expired",
  "RetryLimit",
  "AttemptLimit",
];
