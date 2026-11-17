import type { ContractRow } from "./contracts";

/**
 * Protective-order stack. The addresses come from a dry run of script/DeployOrders.s.sol (Unichain Sepolia)
 * and script/DeployOrderReactive.s.sol (Lasna); the real deploy uses the same deployer nonces. If anything
 * changes, this object is the only place to update.
 */
export const ORDER_STACK = {
  orderBook: "0x20eBb811ecD7198cAbB2D9293Ab13B94097DFe5b",
  pool: "0xb790467931Ad6694747bB90c96ac9b07c0c4DE01",
  weth: "0x0f70a79D1a0DFCB61005AF03084d3bED0e71E932",
  usdc: "0x29583A3d63FD02f1bE462d4b6A1B1BeCeFcaFB87",
  faucet: "0xc02a210DC8d74118205100Bb3744ed09d522fFCf",
  // Same address as the Unichain faucet: both are the deployer's nonce-8 contract, on two different chains.
  orderReactive: "0xc02a210DC8d74118205100Bb3744ed09d522fFCf",
  /** Unichain Sepolia block of the OrderBook deploy (broadcast/DeployOrders.s.sol). Order scans never read before it. */
  orderBookDeployBlock: 68_054_940n,
} as const;

// Fallbacks for the OrderBook constants, shown until the contract can be read.
export const DEFAULT_MIN_WETH_IN = 10n ** 15n; // MIN_WETH_IN, 0.001 WETH
export const DEFAULT_MIN_USDC_IN = 10n ** 6n; // MIN_USDC_IN, 1 USDC
export const DEFAULT_ORDER_FEE_WEI = 10n ** 14n; // ORDER_FEE, 0.0001 ETH

// OrderReactive constants (src/orders/OrderReactive.sol).
export const MAX_WATCHED_PER_OWNER = 4; // MAX_TRACKED_PER_OWNER
export const MAX_WATCHED_TOTAL = 64; // MAX_TRACKED
export const MAX_SLIPPAGE_RETRIES = 3;
export const MAX_TRIGGER_ATTEMPTS = 5;

/** Fee of the Unichain execution pool (FEE_BPS in script/DeployOrders.s.sol). */
export const ORDER_POOL_FEE_BPS = 30n;

export const ORDER_CONTRACTS: readonly ContractRow[] = [
  { name: "OrderBook", chain: "unichain", address: ORDER_STACK.orderBook },
  { name: "OrderReactive", chain: "lasna", address: ORDER_STACK.orderReactive },
  { name: "Unichain pool", chain: "unichain", address: ORDER_STACK.pool },
  { name: "Test WETH on Unichain", chain: "unichain", address: ORDER_STACK.weth },
  { name: "Test USDC on Unichain", chain: "unichain", address: ORDER_STACK.usdc },
  { name: "Test-token faucet on Unichain", chain: "unichain", address: ORDER_STACK.faucet },
];
