import type { ChainKey } from "@/config/chains";
import { formatWholeSeconds } from "@/lib/format";
import { KIND_SPEC, outputToken } from "./kinds";
import { MIRROR_REASON_TEXT, OUTCOME_TEXT } from "./labels";
import type { OrderRef, OrderView } from "./orderList";
import { formatPrice, formatToken, ORDER_TOKENS } from "./tokens";
import { latencySeconds, latestOutcome, latestTrigger, placementMirror, type OrderTrail, type TrailStatus } from "./trail";

// Plain-language title and detail for each tracker step. Contract and event names go only in `tech`.

export interface StepText {
  readonly title: string;
  readonly detail: string;
  /** Event, chain and block, for visitors who want to check it on an explorer. */
  readonly tech?: string;
  readonly link?: { readonly chain: ChainKey; readonly hash: string };
}

export interface TrackerInput {
  readonly ref: OrderRef;
  readonly trail: OrderTrail;
  readonly order: OrderView | undefined;
  readonly isLasnaPartial: boolean;
  readonly isUnichainPartial: boolean;
  readonly status: TrailStatus;
}

const UNTRACKED_AT_PLACEMENT = new Set(["PlacedUntracked", "OwnerLimit"]);

export function placedText({ ref, order }: TrackerInput): StepText {
  const held = order?.tokenIn ? formatToken(order.amountIn, ORDER_TOKENS[order.tokenIn]) : "Your tokens";
  return {
    title: "Order placed on Unichain",
    detail: `${held} ${order?.tokenIn ? "is" : "are"} held by the order book until your trigger is reached or you cancel.`,
    tech: `OrderPlaced · Unichain Sepolia · block ${ref.blockNumber}`,
    link: { chain: "unichain", hash: ref.txHash },
  };
}

export function mirrorText({ trail, isLasnaPartial, status }: TrackerInput): StepText {
  const placement = placementMirror(trail);
  if (placement) {
    const isUntracked = UNTRACKED_AT_PLACEMENT.has(placement.reason);
    return {
      title: isUntracked ? "Not watched" : status.isSettled ? "Reactive watched your order" : "Reactive is watching your order",
      detail: MIRROR_REASON_TEXT[isUntracked ? placement.reason : "Placed"],
      tech: `OrderMirrored · ${placement.reason} · Reactive Lasna · block ${placement.blockNumber}`,
      link: { chain: "lasna", hash: placement.txHash },
    };
  }
  if (status.kind === "mirror-timeout") {
    return { title: "Reactive has not picked it up yet", detail: "This usually takes a few seconds." };
  }
  if (status.isSettled) {
    return {
      title: "Reactive picks up your order",
      detail: isLasnaPartial
        ? "This order is older than the week of Reactive records this page reads."
        : "No Reactive record of this order was found.",
    };
  }
  return {
    title: "Reactive picks up your order",
    detail: "A contract on the Reactive network copies your order so it can watch the price. This usually takes a few seconds.",
  };
}

export function triggerText({ trail, order }: TrackerInput): StepText {
  const trigger = latestTrigger(trail);
  if (trigger) {
    const tries = trail.triggers.length > 1 ? ` It has fired ${trail.triggers.length} times so far.` : "";
    return {
      title: "The price on Base reached your trigger",
      detail: `Base Pool A was at ${formatPrice(trigger.price)} USDC.${tries}`,
      tech: `OrderTriggered · Reactive Lasna · block ${trigger.blockNumber}`,
      link: { chain: "lasna", hash: trigger.txHash },
    };
  }
  const direction = order?.kind ? (KIND_SPEC[order.kind].condition === "PriceAtOrBelow" ? "below" : "above") : undefined;
  return {
    title: "Waiting for the price on Base",
    detail:
      order && direction
        ? `It fires when Base Pool A is at ${formatPrice(order.triggerPrice)} USDC or ${direction}.`
        : "It fires when Base Pool A reaches your trigger price.",
  };
}

const NO_OUTCOME_TEXT: Partial<Record<TrailStatus["kind"], StepText>> = {
  filled: { title: "Filled", detail: "The fill is older than the 14 hours of Unichain records this page reads." },
  cancelled: { title: "Cancelled", detail: "You cancelled the order, and the order book sent your tokens back." },
  expired: { title: "Expired", detail: "The order passed its expiry, and the order book sent your tokens back." },
  "expired-open": {
    title: "Expired before the price got there",
    detail: "Your tokens are still in the order book. Cancel the order to get them back.",
  },
  triggered: {
    title: "Trading on Unichain",
    detail: "The order book is trading on Unichain's pool. This usually takes a few seconds.",
  },
};

export function outcomeText({ trail, order, status }: TrackerInput): StepText {
  const outcome = latestOutcome(trail);
  if (!outcome) {
    return NO_OUTCOME_TEXT[status.kind] ?? { title: "Result", detail: "You see whether the order filled and how much you received." };
  }
  const tech = `OrderOutcome · ${outcome.outcome} · Unichain Sepolia · block ${outcome.blockNumber}`;
  const link = { chain: "unichain", hash: outcome.txHash } as const;
  if (outcome.outcome !== "Filled") return { ...OUTCOME_TEXT[outcome.outcome], tech, link };

  const received = order?.tokenIn ? formatToken(outcome.amountOut, ORDER_TOKENS[outputToken(order.tokenIn)]) : undefined;
  return {
    title: `Filled in ${formatWholeSeconds(latencySeconds(outcome))}`,
    detail: received ? `You received ${received} on Unichain.` : OUTCOME_TEXT.Filled.detail,
    tech,
    link,
  };
}
