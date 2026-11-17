"use client";

import { useRef, useState } from "react";
import type { Address } from "viem";
import { useConfig } from "wagmi";
import { getAccount, getBlock, readContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { erc20Abi } from "@/config/abis";
import { orderChain } from "@/config/chains";
import { orderBookAbi, type Condition } from "@/config/orderAbis";
import { ORDER_STACK } from "@/config/orders";
import { describeTxError } from "@/features/trade/errors";
import { conditionIndex, expiryAt, type ExpiryChoice } from "./kinds";
import { ensureOrderChain } from "./network";
import type { OrderRef } from "./orderList";
import { placedOrderFromLogs } from "./placedOrder";

export type PlacePhase =
  | "idle"
  | "switching"
  | "checking"
  | "approve-sign"
  | "approve-confirm"
  | "place-sign"
  | "place-confirm";

export interface PlaceParams {
  readonly account: Address;
  readonly tokenIn: Address;
  readonly amountIn: bigint;
  readonly condition: Condition;
  readonly triggerPrice: bigint;
  readonly minAmountOut: bigint;
  readonly lifetime: ExpiryChoice;
  /** ORDER_FEE as read from the contract. */
  readonly fee: bigint;
}

export interface PlaceController {
  readonly phase: PlacePhase;
  readonly error: string | undefined;
  /** Switches to Unichain Sepolia if needed, approves exactly `amountIn`, places the order and returns it. */
  readonly place: (params: PlaceParams) => Promise<OrderRef | undefined>;
}

const CHAIN = { chainId: orderChain.id } as const;

export function usePlaceOrder(): PlaceController {
  const config = useConfig();
  const [phase, setPhase] = useState<PlacePhase>("idle");
  const [error, setError] = useState<string>();
  // Set synchronously so a double click cannot start a second flow before the first render.
  const isInFlight = useRef(false);

  async function approveIfNeeded({ account, tokenIn, amountIn }: PlaceParams): Promise<boolean> {
    const allowance = await readContract(config, {
      address: tokenIn,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account, ORDER_STACK.orderBook],
      ...CHAIN,
    });
    if (allowance >= amountIn) return true;
    setPhase("approve-sign");
    // `account` is pinned so switching wallets mid-flow fails instead of placing from another wallet.
    const hash = await writeContract(config, {
      account,
      address: tokenIn,
      abi: erc20Abi,
      functionName: "approve",
      args: [ORDER_STACK.orderBook, amountIn],
      ...CHAIN,
    });
    setPhase("approve-confirm");
    const receipt = await waitForTransactionReceipt(config, { hash, ...CHAIN });
    return receipt.status === "success";
  }

  async function place(params: PlaceParams): Promise<OrderRef | undefined> {
    if (isInFlight.current) return undefined;
    isInFlight.current = true;
    setError(undefined);
    try {
      setPhase(getAccount(config).chainId === orderChain.id ? "checking" : "switching");
      await ensureOrderChain(config);
      setPhase("checking");
      if (!(await approveIfNeeded(params))) {
        setError("The approval transaction reverted. No order was placed.");
        return undefined;
      }

      // The expiry counts from Unichain's own clock, read after the approval so a slow signature cannot push
      // the longest choice past the 7-day limit.
      const block = await getBlock(config, CHAIN);
      setPhase("place-sign");
      const hash = await writeContract(config, {
        account: params.account,
        address: ORDER_STACK.orderBook,
        abi: orderBookAbi,
        functionName: "placeOrder",
        args: [
          params.tokenIn,
          params.amountIn,
          conditionIndex(params.condition),
          params.triggerPrice,
          params.minAmountOut,
          expiryAt(block.timestamp, params.lifetime),
        ],
        value: params.fee,
        ...CHAIN,
      });
      setPhase("place-confirm");
      const receipt = await waitForTransactionReceipt(config, { hash, ...CHAIN });
      if (receipt.status !== "success") {
        setError("The order transaction reverted. Your tokens were not moved.");
        return undefined;
      }
      const placed = placedOrderFromLogs(receipt.logs);
      if (!placed) setError("The order was placed, but its number could not be read. It will appear in your list shortly.");
      return placed;
    } catch (caught: unknown) {
      setError(describeTxError(caught));
      return undefined;
    } finally {
      isInFlight.current = false;
      setPhase("idle");
    }
  }

  return { phase, error, place };
}
