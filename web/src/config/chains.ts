import { defineChain, type Hex } from "viem";
import { baseSepolia, unichainSepolia } from "viem/chains";

export const originChain = baseSepolia;
/** Chain where protective orders are escrowed and filled. */
export const orderChain = unichainSepolia;

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
export const UNICHAIN_SEPOLIA_RPC_URL = "https://sepolia.unichain.org";
// The Unichain docs page that lists the Unichain Sepolia ETH faucets.
export const UNICHAIN_SEPOLIA_FAUCET_URL = "https://docs.unichain.org/docs/tools/faucets";

export type ChainKey = "base" | "lasna" | "unichain";

const EXPLORER: Record<ChainKey, string> = {
  base: "https://sepolia.basescan.org",
  lasna: "https://lasna.reactscan.net",
  unichain: "https://sepolia.uniscan.xyz",
};

export const CHAIN_LABEL: Record<ChainKey, string> = {
  base: "Base Sepolia · 84532",
  lasna: "Reactive Lasna · 5318007",
  unichain: "Unichain Sepolia · 1301",
};

export function txUrl(chain: ChainKey, hash: Hex | string): string {
  return `${EXPLORER[chain]}/tx/${hash}`;
}

export function addressUrl(chain: ChainKey, address: string): string {
  return `${EXPLORER[chain]}/address/${address}`;
}
