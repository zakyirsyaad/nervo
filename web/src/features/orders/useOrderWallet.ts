"use client";

import type { Address } from "viem";
import { useAccount, useBalance, useReadContracts } from "wagmi";
import { erc20Abi } from "@/config/abis";
import { orderChain } from "@/config/chains";
import { ORDER_STACK } from "@/config/orders";

const POLL_INTERVAL_MS = 4_000;

export interface OrderWallet {
  readonly account: Address | undefined;
  readonly isOnOrderChain: boolean;
  /** Test-token balances on Unichain Sepolia. */
  readonly balances: { readonly weth: bigint; readonly usdc: bigint } | undefined;
  /** Native ETH on Unichain Sepolia, for gas and the trigger fee. */
  readonly ethBalance: bigint | undefined;
  readonly refetch: () => void;
}

/** Connected account and its balances on Unichain Sepolia, whichever network the wallet is on. */
export function useOrderWallet(isDeployed: boolean): OrderWallet {
  const { address, chainId } = useAccount();
  const tokens = useReadContracts({
    contracts: [
      { address: ORDER_STACK.weth, abi: erc20Abi, functionName: "balanceOf", args: [address ?? ORDER_STACK.weth], chainId: orderChain.id },
      { address: ORDER_STACK.usdc, abi: erc20Abi, functionName: "balanceOf", args: [address ?? ORDER_STACK.usdc], chainId: orderChain.id },
    ],
    allowFailure: false,
    query: { enabled: Boolean(address) && isDeployed, refetchInterval: POLL_INTERVAL_MS },
  });
  const eth = useBalance({
    address,
    chainId: orderChain.id,
    query: { enabled: Boolean(address), refetchInterval: POLL_INTERVAL_MS },
  });

  return {
    account: address,
    isOnOrderChain: chainId === orderChain.id,
    balances: address && tokens.data ? { weth: tokens.data[0], usdc: tokens.data[1] } : undefined,
    ethBalance: address ? eth.data?.value : undefined,
    refetch: () => {
      void tokens.refetch();
      void eth.refetch();
    },
  };
}
