"use client";

import { useMemo } from "react";
import { useReadContract } from "wagmi";
import { poolAbi } from "@/config/abis";
import { orderChain, originChain } from "@/config/chains";
import { ADDRESSES } from "@/config/contracts";
import { ORDER_STACK } from "@/config/orders";
import type { Reserves } from "@/lib/amm";

const POLL_INTERVAL_MS = 2_000;

export interface OrderPrices {
  /** Base Sepolia Pool A, the price every order watches. */
  readonly base: Reserves | undefined;
  /** Unichain Sepolia pool, where orders trade. */
  readonly unichain: Reserves | undefined;
  readonly isBaseError: boolean;
  readonly isUnichainError: boolean;
}

function toReserves(data: readonly [bigint, bigint] | undefined): Reserves | undefined {
  return data ? { weth: data[0], usdc: data[1] } : undefined;
}

/** Live reserves of the watched Base pool and the Unichain execution pool, read without a wallet. */
export function useOrderPrices(isDeployed: boolean): OrderPrices {
  const base = useReadContract({
    address: ADDRESSES.poolA,
    abi: poolAbi,
    functionName: "getReserves",
    chainId: originChain.id,
    query: { refetchInterval: POLL_INTERVAL_MS },
  });
  const unichain = useReadContract({
    address: ORDER_STACK.pool,
    abi: poolAbi,
    functionName: "getReserves",
    chainId: orderChain.id,
    query: { refetchInterval: POLL_INTERVAL_MS, enabled: isDeployed },
  });

  // wagmi keeps `data` the same object while the reserves do not change, so these hold between polls.
  const baseReserves = useMemo(() => toReserves(base.data), [base.data]);
  const unichainReserves = useMemo(() => toReserves(unichain.data), [unichain.data]);

  return {
    base: baseReserves,
    unichain: unichainReserves,
    isBaseError: base.isError,
    isUnichainError: unichain.isError,
  };
}
