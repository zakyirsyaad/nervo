"use client";

import type { Address } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { erc20Abi } from "@/config/abis";
import { originChain } from "@/config/chains";
import { ADDRESSES } from "@/config/contracts";

const POLL_INTERVAL_MS = 4_000;

export interface WalletState {
  readonly account: Address | undefined;
  readonly isWrongNetwork: boolean;
  readonly balances: { readonly weth: bigint; readonly usdc: bigint } | undefined;
  readonly refetch: () => void;
}

/** Connected account and its test-token balances on Base Sepolia. */
export function useWallet(): WalletState {
  const { address, chainId } = useAccount();
  const { data, refetch } = useReadContracts({
    contracts: [
      { address: ADDRESSES.weth, abi: erc20Abi, functionName: "balanceOf", args: [address ?? ADDRESSES.weth], chainId: originChain.id },
      { address: ADDRESSES.usdc, abi: erc20Abi, functionName: "balanceOf", args: [address ?? ADDRESSES.usdc], chainId: originChain.id },
    ],
    allowFailure: false,
    query: { enabled: Boolean(address), refetchInterval: POLL_INTERVAL_MS },
  });

  return {
    account: address,
    isWrongNetwork: Boolean(address) && chainId !== originChain.id,
    balances: address && data ? { weth: data[0], usdc: data[1] } : undefined,
    refetch: () => void refetch(),
  };
}
