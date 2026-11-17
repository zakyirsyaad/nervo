// Mirrors src/libraries/ArbMath.sol so the page quotes what the contracts will compute.

const BPS = 10_000n;
const WETH_UNIT = 10n ** 18n;

export interface Reserves {
  readonly weth: bigint;
  readonly usdc: bigint;
}

export type TokenSymbol = "weth" | "usdc";
export type Route = "buyA" | "buyB";

export interface RouteQuote {
  readonly route: Route;
  readonly usdcOut: bigint;
}

export interface SwapResult {
  readonly reserves: Reserves;
  readonly amountOut: bigint;
}

export function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps: bigint): bigint {
  if (amountIn === 0n || reserveIn === 0n || reserveOut === 0n) return 0n;
  const amountInAfterFee = amountIn * (BPS - feeBps);
  return (amountInAfterFee * reserveOut) / (reserveIn * BPS + amountInAfterFee);
}

/** USDC received after buying WETH on `buy` and selling it on `sell`. */
export function roundTrip(usdcIn: bigint, buy: Reserves, sell: Reserves, feeBps: bigint): bigint {
  const wethOut = getAmountOut(usdcIn, buy.usdc, buy.weth, feeBps);
  return getAmountOut(wethOut, sell.weth, sell.usdc, feeBps);
}

/** Same tie-break as ArbReactive: buy on A unless buying on B returns strictly more. */
export function bestRoute(usdcIn: bigint, poolA: Reserves, poolB: Reserves, feeBps: bigint): RouteQuote {
  const buyA = roundTrip(usdcIn, poolA, poolB, feeBps);
  const buyB = roundTrip(usdcIn, poolB, poolA, feeBps);
  return buyA >= buyB ? { route: "buyA", usdcOut: buyA } : { route: "buyB", usdcOut: buyB };
}

export function reservesAfterSwap(
  reserves: Reserves,
  tokenIn: TokenSymbol,
  amountIn: bigint,
  feeBps: bigint,
): SwapResult {
  if (tokenIn === "usdc") {
    const amountOut = getAmountOut(amountIn, reserves.usdc, reserves.weth, feeBps);
    return { amountOut, reserves: { weth: reserves.weth - amountOut, usdc: reserves.usdc + amountIn } };
  }
  const amountOut = getAmountOut(amountIn, reserves.weth, reserves.usdc, feeBps);
  return { amountOut, reserves: { weth: reserves.weth + amountIn, usdc: reserves.usdc - amountOut } };
}

/** Spot price in USDC base units (6 decimals) per whole WETH. */
export function spotPriceUsdc(reserves: Reserves): bigint {
  if (reserves.weth === 0n) return 0n;
  return (reserves.usdc * WETH_UNIT) / reserves.weth;
}

/** Gap of `price` against `reference`, in basis points, rounded to the nearest integer. */
export function gapBps(price: bigint, reference: bigint): number {
  if (reference === 0n) return 0;
  const scaled = ((price - reference) * BPS * 10n) / reference;
  return Math.round(Number(scaled) / 10);
}
