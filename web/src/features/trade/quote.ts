import { ARB_INPUT_USDC, MIN_SURPLUS_USDC, POOL_FEE_BPS } from "@/config/contracts";
import {
  bestRoute,
  gapBps,
  reservesAfterSwap,
  spotPriceUsdc,
  type Reserves,
  type Route,
  type TokenSymbol,
} from "@/lib/amm";

export type PoolKey = "A" | "B";
export type PoolPair = Readonly<Record<PoolKey, Reserves>>;

const BPS = 10_000n;

export interface SwapRequest {
  readonly pools: PoolPair;
  readonly pool: PoolKey;
  readonly tokenIn: TokenSymbol;
  readonly amountIn: bigint;
}

export interface SwapPreview {
  readonly amountOut: bigint;
  /** Price of the swapped pool after the swap, USDC base units per WETH. */
  readonly priceAfter: bigint;
  /** Gap of the swapped pool against the other one after the swap. */
  readonly gapBps: number;
  readonly route: Route;
  /** USDC the Reactive contract would quote for its fixed-size round trip. */
  readonly quotedOut: bigint;
  readonly willRequestCallback: boolean;
}

export function otherPool(pool: PoolKey): PoolKey {
  return pool === "A" ? "B" : "A";
}

/** What the pools look like after the swap, and what ArbReactive will decide about it. */
export function previewSwap({ pools, pool, tokenIn, amountIn }: SwapRequest): SwapPreview {
  const swapped = reservesAfterSwap(pools[pool], tokenIn, amountIn, POOL_FEE_BPS);
  const after: PoolPair = { ...pools, [pool]: swapped.reserves };
  const priceAfter = spotPriceUsdc(after[pool]);
  const best = bestRoute(ARB_INPUT_USDC, after.A, after.B, POOL_FEE_BPS);

  return {
    amountOut: swapped.amountOut,
    priceAfter,
    gapBps: gapBps(priceAfter, spotPriceUsdc(after[otherPool(pool)])),
    route: best.route,
    quotedOut: best.usdcOut,
    willRequestCallback: amountIn > 0n && best.usdcOut >= ARB_INPUT_USDC + MIN_SURPLUS_USDC,
  };
}

export function applySlippage(amountOut: bigint, toleranceBps: bigint): bigint {
  return (amountOut * (BPS - toleranceBps)) / BPS;
}
