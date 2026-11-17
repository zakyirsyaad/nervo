import { createPublicClient, http } from "viem";
import { BASE_SEPOLIA_RPC_URL, lasna, originChain } from "@/config/chains";

// Read-only clients for the loop tracker. Lasna is never added to the visitor's wallet.
export const baseClient = createPublicClient({ chain: originChain, transport: http(BASE_SEPOLIA_RPC_URL) });
export const lasnaClient = createPublicClient({ chain: lasna, transport: http() });
