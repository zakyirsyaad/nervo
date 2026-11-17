import { describe, expect, test } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex, type Log } from "viem";
import { orderBookAbi } from "@/config/orderAbis";
import { ORDER_STACK } from "@/config/orders";
import { placedOrderFromLogs } from "./placedOrder";

const OWNER: Address = "0x00000000000000000000000000000000000000a1";
const TX: Hex = `0x${"ab".repeat(32)}`;

function orderPlacedLog(address: Address, orderId: bigint): Log {
  const topics = encodeEventTopics({ abi: orderBookAbi, eventName: "OrderPlaced", args: { orderId, owner: OWNER } });
  const data = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }, { type: "uint8" }, { type: "uint256" }, { type: "uint256" }, { type: "uint64" }],
    [ORDER_STACK.weth, 10n ** 18n, 0, 2_970_000_000n, 2_900_000_000n, 1_800_000_000n],
  );
  return {
    address,
    topics: topics as [Hex, ...Hex[]],
    data,
    blockNumber: 68_000_123n,
    transactionHash: TX,
    logIndex: 4,
    blockHash: `0x${"cd".repeat(32)}`,
    transactionIndex: 0,
    removed: false,
  };
}

describe("placedOrderFromLogs", () => {
  test("reads the new order id from the order book's OrderPlaced log", () => {
    const placed = placedOrderFromLogs([orderPlacedLog(ORDER_STACK.orderBook, 12n)]);

    expect(placed).toEqual({ id: 12n, txHash: TX, blockNumber: 68_000_123n });
  });

  test("ignores the same event from another contract", () => {
    const stranger: Address = "0x00000000000000000000000000000000000000ff";

    expect(placedOrderFromLogs([orderPlacedLog(stranger, 12n)])).toBeUndefined();
    expect(placedOrderFromLogs([])).toBeUndefined();
  });
});
