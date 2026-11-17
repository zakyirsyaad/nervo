import { parseEventLogs, type Log } from "viem";
import { orderBookAbi } from "@/config/orderAbis";
import { ORDER_STACK } from "@/config/orders";
import type { OrderRef } from "./orderList";

/** The order a placeOrder receipt created, read from the order book's OrderPlaced log. */
export function placedOrderFromLogs(logs: readonly Log[]): OrderRef | undefined {
  const placed = parseEventLogs({ abi: orderBookAbi, eventName: "OrderPlaced", logs: [...logs] }).find(
    (log) => log.address.toLowerCase() === ORDER_STACK.orderBook.toLowerCase(),
  );
  if (!placed || placed.blockNumber === null || placed.transactionHash === null) return undefined;
  return { id: placed.args.orderId, txHash: placed.transactionHash, blockNumber: placed.blockNumber };
}
