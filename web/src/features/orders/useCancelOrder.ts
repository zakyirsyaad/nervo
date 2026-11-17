"use client";

import { useRef, useState } from "react";
import type { Address } from "viem";
import { useConfig } from "wagmi";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { orderChain } from "@/config/chains";
import { orderBookAbi } from "@/config/orderAbis";
import { ORDER_STACK } from "@/config/orders";
import { describeTxError } from "@/features/trade/errors";
import { ensureOrderChain } from "./network";

export interface CancelError {
  readonly orderId: bigint;
  readonly message: string;
}

export interface CancelController {
  /** Order being cancelled right now, if any. */
  readonly cancellingId: bigint | undefined;
  readonly error: CancelError | undefined;
  /** Resolves true once the cancel transaction succeeded and the escrow went back to the owner. */
  readonly cancel: (account: Address, orderId: bigint) => Promise<boolean>;
}

export function useCancelOrder(): CancelController {
  const config = useConfig();
  const [cancellingId, setCancellingId] = useState<bigint>();
  const [error, setError] = useState<CancelError>();
  const isInFlight = useRef(false);

  async function cancel(account: Address, orderId: bigint): Promise<boolean> {
    if (isInFlight.current) return false;
    isInFlight.current = true;
    setError(undefined);
    setCancellingId(orderId);
    try {
      await ensureOrderChain(config);
      const hash = await writeContract(config, {
        account,
        address: ORDER_STACK.orderBook,
        abi: orderBookAbi,
        functionName: "cancelOrder",
        args: [orderId],
        chainId: orderChain.id,
      });
      const receipt = await waitForTransactionReceipt(config, { hash, chainId: orderChain.id });
      if (receipt.status !== "success") {
        setError({ orderId, message: "The cancel transaction reverted. The order is unchanged." });
        return false;
      }
      return true;
    } catch (caught: unknown) {
      setError({ orderId, message: describeTxError(caught) });
      return false;
    } finally {
      isInFlight.current = false;
      setCancellingId(undefined);
    }
  }

  return { cancellingId, error, cancel };
}
