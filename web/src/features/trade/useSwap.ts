"use client";

import { useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { useConfig } from "wagmi";
import { readContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { erc20Abi, poolAbi } from "@/config/abis";
import { originChain } from "@/config/chains";
import { describeTxError } from "./errors";

export type SwapPhase = "idle" | "checking" | "approve-sign" | "approve-confirm" | "swap-sign" | "swap-confirm";

export interface SwapParams {
  readonly account: Address;
  readonly pool: Address;
  readonly tokenIn: Address;
  readonly amountIn: bigint;
  readonly minAmountOut: bigint;
}

export interface SwapController {
  readonly phase: SwapPhase;
  readonly error: string | undefined;
  /** Approves exactly `amountIn` if needed, swaps, and resolves with the swap's transaction hash. */
  readonly swap: (params: SwapParams) => Promise<Hex | undefined>;
}

export function useSwap(): SwapController {
  const config = useConfig();
  const [phase, setPhase] = useState<SwapPhase>("idle");
  const [error, setError] = useState<string>();
  // Set synchronously so a double click cannot start a second flow before the first render.
  const isInFlight = useRef(false);

  async function swap({ account, pool, tokenIn, amountIn, minAmountOut }: SwapParams): Promise<Hex | undefined> {
    if (isInFlight.current) return undefined;
    isInFlight.current = true;
    setError(undefined);
    setPhase("checking");
    try {
      const allowance = await readContract(config, {
        address: tokenIn,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, pool],
        chainId: originChain.id,
      });
      if (allowance < amountIn) {
        setPhase("approve-sign");
        // `account` is pinned so switching wallets mid-flow fails instead of splitting the trade.
        const approveHash = await writeContract(config, {
          account,
          address: tokenIn,
          abi: erc20Abi,
          functionName: "approve",
          args: [pool, amountIn],
          chainId: originChain.id,
        });
        setPhase("approve-confirm");
        const approval = await waitForTransactionReceipt(config, { hash: approveHash, chainId: originChain.id });
        if (approval.status !== "success") {
          setError("The approval transaction reverted. Nothing was swapped.");
          return undefined;
        }
      }

      setPhase("swap-sign");
      const swapHash = await writeContract(config, {
        account,
        address: pool,
        abi: poolAbi,
        functionName: "swap",
        args: [tokenIn, amountIn, minAmountOut, account],
        chainId: originChain.id,
      });
      setPhase("swap-confirm");
      const receipt = await waitForTransactionReceipt(config, { hash: swapHash, chainId: originChain.id });
      if (receipt.status !== "success") {
        setError("The swap transaction reverted.");
        return undefined;
      }
      return swapHash;
    } catch (caught: unknown) {
      setError(describeTxError(caught));
      return undefined;
    } finally {
      isInFlight.current = false;
      setPhase("idle");
    }
  }

  return { phase, error, swap };
}
