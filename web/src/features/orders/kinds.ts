import { ORDER_CONDITIONS, type Condition } from "@/config/orderAbis";
import { getAmountOut, type Reserves, type TokenSymbol } from "@/lib/amm";
import { applySlippage } from "@/features/trade/quote";

export type OrderKind = "stop-loss" | "take-profit" | "limit-buy";

export interface KindSpec {
  readonly name: string;
  readonly tokenIn: TokenSymbol;
  readonly condition: Condition;
  /** Where the trigger is prefilled, against the current Base price. */
  readonly triggerOffsetBps: bigint;
  /** One sentence describing what the order does. */
  readonly summary: string;
}

export const ORDER_KINDS: readonly OrderKind[] = ["stop-loss", "take-profit", "limit-buy"];

export const KIND_SPEC: Readonly<Record<OrderKind, KindSpec>> = {
  "stop-loss": {
    name: "Stop-loss",
    tokenIn: "weth",
    condition: "PriceAtOrBelow",
    triggerOffsetBps: -100n,
    summary: "Sells your WETH for USDC if the price falls to your trigger or below, to limit a loss.",
  },
  "take-profit": {
    name: "Take-profit",
    tokenIn: "weth",
    condition: "PriceAtOrAbove",
    triggerOffsetBps: 100n,
    summary: "Sells your WETH for USDC if the price rises to your trigger or above, to lock in a gain.",
  },
  "limit-buy": {
    name: "Limit buy",
    tokenIn: "usdc",
    condition: "PriceAtOrBelow",
    triggerOffsetBps: -100n,
    summary: "Buys WETH with your USDC if the price falls to your trigger or below.",
  },
};

const BPS = 10_000n;
/** "You receive at least" starts this far below the Unichain pool's current quote. */
export const MIN_OUT_TOLERANCE_BPS = 100n;

/** The kind a stored order corresponds to, or undefined for a combination this page does not offer. */
export function kindFor(tokenIn: TokenSymbol, condition: Condition): OrderKind | undefined {
  return ORDER_KINDS.find((kind) => KIND_SPEC[kind].tokenIn === tokenIn && KIND_SPEC[kind].condition === condition);
}

/** Position of the condition in the Solidity enum, as placeOrder expects it. */
export function conditionIndex(condition: Condition): number {
  return ORDER_CONDITIONS.indexOf(condition);
}

export function outputToken(tokenIn: TokenSymbol): TokenSymbol {
  return tokenIn === "weth" ? "usdc" : "weth";
}

/** Trigger price prefilled 1% below (stop-loss, limit buy) or above (take-profit) the current price. */
export function defaultTriggerPrice(price: bigint, kind: OrderKind): bigint {
  return (price * (BPS + KIND_SPEC[kind].triggerOffsetBps)) / BPS;
}

export interface MinOutQuote {
  /** What the Unichain pool would pay for the order right now. */
  readonly amountOut: bigint;
  readonly minAmountOut: bigint;
}

/** Quotes the order on the Unichain pool and keeps `toleranceBps` of room as the minimum to receive. */
export function quoteMinOut(
  reserves: Reserves,
  tokenIn: TokenSymbol,
  amountIn: bigint,
  feeBps: bigint,
  toleranceBps: bigint = MIN_OUT_TOLERANCE_BPS,
): MinOutQuote {
  const amountOut =
    tokenIn === "weth"
      ? getAmountOut(amountIn, reserves.weth, reserves.usdc, feeBps)
      : getAmountOut(amountIn, reserves.usdc, reserves.weth, feeBps);
  return { amountOut, minAmountOut: applySlippage(amountOut, toleranceBps) };
}

/** True when the price already meets the condition, so the order fires on the next price update. */
export function triggersImmediately(kind: OrderKind, triggerPrice: bigint, currentPrice: bigint): boolean {
  return KIND_SPEC[kind].condition === "PriceAtOrBelow" ? currentPrice <= triggerPrice : currentPrice >= triggerPrice;
}

export interface ExpiryChoice {
  readonly id: "1h" | "1d" | "7d";
  readonly label: string;
  readonly seconds: bigint;
}

const HOUR = 3_600n;
const DAY = 24n * HOUR;

// The OrderBook accepts an expiry at most MAX_ORDER_LIFETIME (7 days) ahead. The longest choice keeps a
// minute of room for the time between reading the chain clock and the transaction landing.
export const EXPIRY_CHOICES: readonly ExpiryChoice[] = [
  { id: "1h", label: "1 hour", seconds: HOUR },
  { id: "1d", label: "1 day", seconds: DAY },
  { id: "7d", label: "7 days", seconds: 7n * DAY - 60n },
];

/** Expiry timestamp for a choice, counted from the order chain's latest block time. */
export function expiryAt(chainNow: bigint, choice: ExpiryChoice): bigint {
  return chainNow + choice.seconds;
}
