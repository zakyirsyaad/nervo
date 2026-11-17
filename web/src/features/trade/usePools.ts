"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { poolAbi } from "@/config/abis";
import { originChain } from "@/config/chains";
import { ADDRESSES } from "@/config/contracts";
import type { PoolPair } from "./quote";

const POLL_INTERVAL_MS = 2_000;

const POOL_CALLS = [
  { address: ADDRESSES.poolA, abi: poolAbi, functionName: "getReserves", chainId: originChain.id },
  { address: ADDRESSES.poolB, abi: poolAbi, functionName: "getReserves", chainId: originChain.id },
] as const;

export interface PoolsQuery {
  readonly pools: PoolPair | undefined;
  readonly isError: boolean;
}

/** Live reserves of both pools, read without a wallet. */
export function usePools(): PoolsQuery {
  const { data, isError } = useReadContracts({
    contracts: POOL_CALLS,
    allowFailure: false,
    query: { refetchInterval: POLL_INTERVAL_MS },
  });

  // wagmi keeps `data` the same object while the reserves do not change, so this holds between polls.
  const pools = useMemo(() => {
    if (!data) return undefined;
    const [reservesA, reservesB] = data;
    return { A: { weth: reservesA[0], usdc: reservesA[1] }, B: { weth: reservesB[0], usdc: reservesB[1] } };
  }, [data]);
  return { pools, isError };
}
