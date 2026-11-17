import type { Address, Hex } from "viem";
import { ORDER_CONDITIONS, ORDER_STATUSES, type OrderStatus } from "@/config/orderAbis";
import type { TokenSymbol } from "@/lib/amm";
import { kindFor, type OrderKind } from "./kinds";

/** Where an order was placed. Enough to show it and to follow it. */
export interface OrderRef {
  readonly id: bigint;
  readonly txHash: Hex;
  readonly blockNumber: bigint;
}

/** OrderBook.getOrder, with enums as their uint8 values. */
export interface OrderDetails {
  readonly owner: Address;
  readonly expiry: bigint;
  readonly condition: number;
  readonly status: number;
  readonly tokenIn: Address;
  readonly amountIn: bigint;
  readonly triggerPrice: bigint;
  readonly minAmountOut: bigint;
}

export interface OrderView {
  readonly ref: OrderRef;
  readonly owner: Address;
  readonly kind: OrderKind | undefined;
  readonly tokenIn: TokenSymbol | undefined;
  readonly amountIn: bigint;
  readonly triggerPrice: bigint;
  readonly minAmountOut: bigint;
  readonly expiry: bigint;
  readonly status: OrderStatus;
  /** Past its expiry by the order chain's clock. */
  readonly isExpired: boolean;
}

export interface TokenAddresses {
  readonly weth: Address;
  readonly usdc: Address;
}

/** One entry per order id, newest order first. Earlier lists win when an id repeats. */
export function mergeOrderRefs(...lists: readonly (readonly OrderRef[])[]): OrderRef[] {
  const byId = new Map<bigint, OrderRef>();
  for (const ref of lists.flat()) {
    if (!byId.has(ref.id)) byId.set(ref.id, ref);
  }
  return [...byId.values()].sort((a, b) => (a.id === b.id ? 0 : a.id > b.id ? -1 : 1));
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function tokenSymbolOf(address: Address, tokens: TokenAddresses): TokenSymbol | undefined {
  if (sameAddress(address, tokens.weth)) return "weth";
  if (sameAddress(address, tokens.usdc)) return "usdc";
  return undefined;
}

export function toOrderView(ref: OrderRef, details: OrderDetails, chainNow: bigint, tokens: TokenAddresses): OrderView {
  const tokenIn = tokenSymbolOf(details.tokenIn, tokens);
  const condition = ORDER_CONDITIONS[details.condition];
  const status = ORDER_STATUSES[details.status] ?? "None";
  return {
    ref,
    owner: details.owner,
    kind: tokenIn && condition ? kindFor(tokenIn, condition) : undefined,
    tokenIn,
    amountIn: details.amountIn,
    triggerPrice: details.triggerPrice,
    minAmountOut: details.minAmountOut,
    expiry: details.expiry,
    status,
    isExpired: chainNow > details.expiry,
  };
}

/** The OrderBook lets only the owner cancel, and only while the order is open (expired or not). */
export function canCancel(view: OrderView, account: Address | undefined): boolean {
  return Boolean(account) && view.status === "Open" && sameAddress(view.owner, account ?? "");
}

// --- browser cache of the orders this wallet placed, so older orders survive a bounded log scan ---

export interface OrderCache {
  /** Last block the log scan covered. */
  readonly scannedTo: bigint | undefined;
  readonly refs: readonly OrderRef[];
}

const CACHE_VERSION = 1;
const EMPTY_CACHE: OrderCache = { scannedTo: undefined, refs: [] };
const DIGITS = /^\d+$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

export function orderCacheKey(chainId: number, orderBook: Address, owner: Address): string {
  return `arb-loop:orders:v${CACHE_VERSION}:${chainId}:${orderBook.toLowerCase()}:${owner.toLowerCase()}`;
}

export function serializeOrderCache(cache: OrderCache): string {
  return JSON.stringify({
    v: CACHE_VERSION,
    scannedTo: cache.scannedTo?.toString(),
    refs: cache.refs.map((ref) => ({ id: ref.id.toString(), txHash: ref.txHash, blockNumber: ref.blockNumber.toString() })),
  });
}

function parseRef(value: unknown): OrderRef | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { id, txHash, blockNumber } = value as Record<string, unknown>;
  if (typeof id !== "string" || !DIGITS.test(id)) return undefined;
  if (typeof txHash !== "string" || !TX_HASH.test(txHash)) return undefined;
  if (typeof blockNumber !== "string" || !DIGITS.test(blockNumber)) return undefined;
  return { id: BigInt(id), txHash: txHash as Hex, blockNumber: BigInt(blockNumber) };
}

/** Reads what serializeOrderCache wrote. Anything missing, broken or from another version reads as empty. */
export function parseOrderCache(raw: string | null): OrderCache {
  if (!raw) return EMPTY_CACHE;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return EMPTY_CACHE;
  }
  if (typeof data !== "object" || data === null) return EMPTY_CACHE;
  const { v, scannedTo, refs } = data as Record<string, unknown>;
  if (v !== CACHE_VERSION || !Array.isArray(refs)) return EMPTY_CACHE;
  return {
    scannedTo: typeof scannedTo === "string" && DIGITS.test(scannedTo) ? BigInt(scannedTo) : undefined,
    refs: refs.map(parseRef).filter((ref): ref is OrderRef => ref !== undefined),
  };
}
