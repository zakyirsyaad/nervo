import { describe, expect, test } from "vitest";
import { ContractFunctionRevertedError, encodeErrorResult, SwitchChainError, UserRejectedRequestError } from "viem";
import { ConnectorChainMismatchError, SwitchChainNotSupportedError } from "wagmi";
import { orderBookAbi } from "@/config/orderAbis";
import { describeTxError } from "./errors";

type OrderBookError = Extract<(typeof orderBookAbi)[number], { type: "error" }>;

function orderBookRevert(errorName: OrderBookError["name"], args: readonly unknown[]): ContractFunctionRevertedError {
  const data = encodeErrorResult({ abi: orderBookAbi, errorName, args } as Parameters<typeof encodeErrorResult>[0]);
  return new ContractFunctionRevertedError({ abi: orderBookAbi, data, functionName: "placeOrder" });
}

describe("describeTxError for the order book", () => {
  test("explains each order rejection in plain words", () => {
    expect(describeTxError(orderBookRevert("WrongOrderFee", [0n, 10n ** 14n]))).toMatch(/trigger fee/);
    expect(describeTxError(orderBookRevert("OrderTooSmall", [1n, 10n ** 15n]))).toMatch(/smaller than the minimum/);
    expect(describeTxError(orderBookRevert("ZeroMinAmountOut", []))).toMatch(/above zero/);
    expect(describeTxError(orderBookRevert("ExpiryTooFar", [1n, 2n]))).toMatch(/7 days/);
    expect(describeTxError(orderBookRevert("OrderNotOpen", [1n, 2]))).toMatch(/no longer open/);
    expect(describeTxError(orderBookRevert("NotOrderOwner", [1n, "0x00000000000000000000000000000000000000a1"]))).toMatch(
      /Only the wallet that placed/,
    );
  });

  test("names an unknown revert by its error name", () => {
    expect(describeTxError(orderBookRevert("ZeroTriggerPrice", []))).toMatch(/trigger price/);
  });
});

describe("describeTxError for wallets and networks", () => {
  test("recognises a cancelled request", () => {
    expect(describeTxError(new UserRejectedRequestError(new Error("denied")))).toBe("You cancelled the request in your wallet.");
  });

  test("asks the visitor to switch networks by hand when the wallet cannot", () => {
    expect(describeTxError(new SwitchChainError(new Error("4902")))).toMatch(/Switch networks in your wallet/);
    expect(describeTxError(new SwitchChainNotSupportedError({ connector: { name: "Test" } as never }))).toMatch(
      /Switch networks in your wallet/,
    );
  });

  test("reports a wallet on the wrong network", () => {
    const error = new ConnectorChainMismatchError({ connectionChainId: 84532, connectorChainId: 1301 });

    expect(describeTxError(error)).toMatch(/different network/);
  });
});
