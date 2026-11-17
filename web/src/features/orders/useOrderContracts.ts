"use client";

import { useBytecode, useReadContracts } from "wagmi";
import { orderChain } from "@/config/chains";
import { orderBookAbi } from "@/config/orderAbis";
import { DEFAULT_MIN_USDC_IN, DEFAULT_MIN_WETH_IN, ORDER_STACK } from "@/config/orders";
import type { Deployment } from "./orderDraft";

const DEPLOYMENT_RECHECK_MS = 60_000;

export interface OrderContracts {
  readonly deployment: Deployment;
  readonly isDeployed: boolean;
  /** ETH sent with placeOrder to prepay the callback. Undefined until read from the contract. */
  readonly orderFee: bigint | undefined;
  readonly minWethIn: bigint;
  readonly minUsdcIn: bigint;
}

const CONSTANT_CALLS = [
  { address: ORDER_STACK.orderBook, abi: orderBookAbi, functionName: "ORDER_FEE", chainId: orderChain.id },
  { address: ORDER_STACK.orderBook, abi: orderBookAbi, functionName: "MIN_WETH_IN", chainId: orderChain.id },
  { address: ORDER_STACK.orderBook, abi: orderBookAbi, functionName: "MIN_USDC_IN", chainId: orderChain.id },
] as const;

/** Whether the OrderBook exists on Unichain Sepolia yet, and its constants once it does. */
export function useOrderContracts(): OrderContracts {
  const code = useBytecode({
    address: ORDER_STACK.orderBook,
    chainId: orderChain.id,
    query: { staleTime: DEPLOYMENT_RECHECK_MS, refetchInterval: DEPLOYMENT_RECHECK_MS },
  });
  const deployment: Deployment = code.isPending ? "checking" : code.isError ? "error" : code.data ? "deployed" : "missing";
  const isDeployed = deployment === "deployed";

  const constants = useReadContracts({ contracts: CONSTANT_CALLS, query: { enabled: isDeployed, staleTime: Infinity } });
  const [fee, minWeth, minUsdc] = constants.data ?? [];

  return {
    deployment,
    isDeployed,
    orderFee: fee?.status === "success" ? fee.result : undefined,
    minWethIn: minWeth?.status === "success" ? minWeth.result : DEFAULT_MIN_WETH_IN,
    minUsdcIn: minUsdc?.status === "success" ? minUsdc.result : DEFAULT_MIN_USDC_IN,
  };
}
