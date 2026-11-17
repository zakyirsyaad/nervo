import { createPublicClient, http } from "viem";
import { orderChain, UNICHAIN_SEPOLIA_RPC_URL } from "@/config/chains";

// Read-only client for Unichain Sepolia. Base Sepolia and Lasna reuse the trade tracker's clients.
export const unichainClient = createPublicClient({ chain: orderChain, transport: http(UNICHAIN_SEPOLIA_RPC_URL) });

export { baseClient, lasnaClient } from "@/features/trade/clients";

/** Unichain Sepolia's public RPC rejects eth_getLogs when toBlock - fromBlock exceeds 1,000. */
export const UNICHAIN_LOG_BLOCKS = 1_000n;
/** Lasna's RPC rejects eth_getLogs over 30,000 blocks (both ends included). */
export const LASNA_LOG_BLOCKS = 30_000n;
/** Parallel eth_getLogs requests per scan. */
export const UNICHAIN_SCAN_CONCURRENCY = 8;
export const LASNA_SCAN_CONCURRENCY = 4;
