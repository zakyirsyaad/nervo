import type { Address } from "viem";
import { orderBookAbi, orderReactiveAbi } from "@/config/orderAbis";
import { ORDER_STACK } from "@/config/orders";
import { lookbackStart, nextScanStart, splitRange } from "@/lib/blockRange";
import { mapLimited } from "@/lib/concurrency";
import { lasnaClient, UNICHAIN_LOG_BLOCKS, UNICHAIN_SCAN_CONCURRENCY, unichainClient } from "./clients";
import { mergeOrderRefs, toOrderView, type OrderCache, type OrderDetails, type OrderRef, type OrderView } from "./orderList";

/** How far back the order list looks for OrderPlaced logs: about 14 hours of 1-second Unichain blocks. */
export const ORDER_SCAN_LOOKBACK = 50_000n;

/**
 * Reads this owner's OrderPlaced logs from where the last scan stopped (or the start of the look-back window)
 * to the chain head, 1,000 blocks per request, and merges them into the cache.
 */
export async function scanPlacedOrders(owner: Address, cache: OrderCache): Promise<OrderCache> {
  const head = await unichainClient.getBlockNumber({ cacheTime: 0 });
  const windowStart = lookbackStart(head, ORDER_SCAN_LOOKBACK, ORDER_STACK.orderBookDeployBlock);
  const ranges = splitRange(nextScanStart(cache.scannedTo, windowStart), head, UNICHAIN_LOG_BLOCKS);

  const pages = await mapLimited(ranges, UNICHAIN_SCAN_CONCURRENCY, (range) =>
    unichainClient.getContractEvents({
      address: ORDER_STACK.orderBook,
      abi: orderBookAbi,
      eventName: "OrderPlaced",
      args: { owner },
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
    }),
  );
  const found = pages
    .flat()
    .flatMap((log): OrderRef[] =>
      log.args.orderId === undefined ? [] : [{ id: log.args.orderId, txHash: log.transactionHash, blockNumber: log.blockNumber }],
    );

  const scannedTo = cache.scannedTo !== undefined && cache.scannedTo > head ? cache.scannedTo : head;
  return { scannedTo, refs: mergeOrderRefs(cache.refs, found) };
}

export async function readOrderDetails(orderId: bigint): Promise<OrderDetails> {
  return unichainClient.readContract({
    address: ORDER_STACK.orderBook,
    abi: orderBookAbi,
    functionName: "getOrder",
    args: [orderId],
  });
}

/** Current state of each order, judged against the order chain's clock. One multicall plus the latest block. */
export async function readOrderViews(refs: readonly OrderRef[]): Promise<OrderView[]> {
  if (refs.length === 0) return [];
  const [orders, block] = await Promise.all([
    unichainClient.multicall({
      contracts: refs.map((ref) => ({
        address: ORDER_STACK.orderBook,
        abi: orderBookAbi,
        functionName: "getOrder" as const,
        args: [ref.id] as const,
      })),
      allowFailure: false,
    }),
    unichainClient.getBlock({ blockTag: "latest" }),
  ]);
  return refs.map((ref, index) => toOrderView(ref, orders[index], block.timestamp, ORDER_STACK));
}

/** Orders the Reactive contract on Lasna currently watches for this owner. */
export async function readWatchedCount(owner: Address): Promise<number> {
  const count = await lasnaClient.readContract({
    address: ORDER_STACK.orderReactive,
    abi: orderReactiveAbi,
    functionName: "trackedPerOwner",
    args: [owner],
  });
  return Number(count);
}
