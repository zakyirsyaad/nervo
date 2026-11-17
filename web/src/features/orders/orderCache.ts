import type { Address } from "viem";
import { orderChain } from "@/config/chains";
import { ORDER_STACK } from "@/config/orders";
import { mergeOrderRefs, orderCacheKey, parseOrderCache, serializeOrderCache, type OrderCache, type OrderRef } from "./orderList";

// The cache only saves work: when storage is blocked or full, every read is empty and the log scan still runs.

function keyFor(owner: Address): string {
  return orderCacheKey(orderChain.id, ORDER_STACK.orderBook, owner);
}

export function loadOrderCache(owner: Address): OrderCache {
  try {
    return parseOrderCache(window.localStorage.getItem(keyFor(owner)));
  } catch {
    return parseOrderCache(null);
  }
}

export function saveOrderCache(owner: Address, cache: OrderCache): void {
  try {
    window.localStorage.setItem(keyFor(owner), serializeOrderCache(cache));
  } catch {
    // Storage is unavailable (private window, quota, blocked site data); the next scan rebuilds the list.
  }
}

/** Adds an order this browser just placed, so it shows up before the next scan reaches its block. */
export function rememberOrder(owner: Address, ref: OrderRef): void {
  const cache = loadOrderCache(owner);
  saveOrderCache(owner, { scannedTo: cache.scannedTo, refs: mergeOrderRefs([ref], cache.refs) });
}
