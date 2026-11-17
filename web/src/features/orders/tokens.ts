import type { Address } from "viem";
import { ORDER_STACK } from "@/config/orders";
import type { TokenSymbol } from "@/lib/amm";
import { formatAmount } from "@/lib/format";

export interface OrderToken {
  readonly symbol: string;
  readonly address: Address;
  readonly decimals: number;
  /** Decimals shown for balances and amounts. */
  readonly display: number;
  /** Decimals prefilled in an input. */
  readonly inputDecimals: number;
  /** A valid amount to suggest in messages and to prefill. */
  readonly example: string;
}

/** The test tokens on Unichain Sepolia. They share symbols with the Base Sepolia ones but are separate tokens. */
export const ORDER_TOKENS: Readonly<Record<TokenSymbol, OrderToken>> = {
  weth: { symbol: "WETH", address: ORDER_STACK.weth, decimals: 18, display: 4, inputDecimals: 6, example: "0.5" },
  usdc: { symbol: "USDC", address: ORDER_STACK.usdc, decimals: 6, display: 2, inputDecimals: 2, example: "1,000" },
};

/** USDC price per WETH, as stored in the contracts. */
export const PRICE_DECIMALS = 6;

export function formatToken(value: bigint, token: OrderToken): string {
  return `${formatAmount(value, token.decimals, token.display)} ${token.symbol}`;
}

export function formatPrice(price: bigint): string {
  return formatAmount(price, PRICE_DECIMALS, 2);
}
