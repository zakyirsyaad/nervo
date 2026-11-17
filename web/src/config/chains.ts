import { defineChain, type Hex } from "viem";
import { baseSepolia } from "viem/chains";

export const originChain = baseSepolia;

export const lasna = defineChain({
  id: 5318007,
  name: "Reactive Lasna",
  nativeCurrency: { name: "Lasna REACT", symbol: "lREACT", decimals: 18 },
  rpcUrls: { default: { http: ["https://lasna-rpc.rnk.dev/"] } },
  blockExplorers: { default: { name: "Reactscan", url: "https://lasna.reactscan.net" } },
  testnet: true,
});

export const BASE_SEPOLIA_RPC_URL = "https://sepolia.base.org";
export const BASE_SEPOLIA_FAUCET_URL = "https://docs.base.org/base-chain/tools/network-faucets";

const BASE_EXPLORER = "https://sepolia.basescan.org";
const LASNA_EXPLORER = "https://lasna.reactscan.net";

export type ChainKey = "base" | "lasna";

export const CHAIN_LABEL: Record<ChainKey, string> = {
  base: "Base Sepolia · 84532",
  lasna: "Reactive Lasna · 5318007",
};

export function txUrl(chain: ChainKey, hash: Hex | string): string {
  return `${chain === "base" ? BASE_EXPLORER : LASNA_EXPLORER}/tx/${hash}`;
}

export function addressUrl(chain: ChainKey, address: string): string {
  return `${chain === "base" ? BASE_EXPLORER : LASNA_EXPLORER}/address/${address}`;
}
