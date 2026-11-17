import { isAddress, type Address } from "viem";
import type { ChainKey } from "./chains";

export const ADDRESSES = {
  arbReactive: "0x0f70a79D1a0DFCB61005AF03084d3bED0e71E932",
  arbExecutor: "0xb568530a915a7Ae01FBE5917E1B21d666b24DFE4",
  poolA: "0x82DEA86F73edF0CC76cd2Ff4Ae8612380e63CE6F",
  poolB: "0xf68dE754214b013c206AFD5753b9f26428C29228",
  weth: "0x29583A3d63FD02f1bE462d4b6A1B1BeCeFcaFB87",
  usdc: "0xb790467931Ad6694747bB90c96ac9b07c0c4DE01",
} as const satisfies Record<string, Address>;

const faucetFromEnv = process.env.NEXT_PUBLIC_FAUCET_ADDRESS;

/** Undefined until the faucet is deployed and its address is set in the environment. */
export const FAUCET_ADDRESS: Address | undefined =
  faucetFromEnv && isAddress(faucetFromEnv) ? faucetFromEnv : undefined;

export const GITHUB_URL: string | undefined = process.env.NEXT_PUBLIC_GITHUB_URL || undefined;

// Deployment parameters of ArbReactive (script/DeployReactive.s.sol).
export const ARB_INPUT_USDC = 1_000_000_000n;
export const MIN_SURPLUS_USDC = 2_000_000n;
export const POOL_FEE_BPS = 30n;

export const WETH_DECIMALS = 18;
export const USDC_DECIMALS = 6;

export interface ContractRow {
  readonly name: string;
  readonly chain: ChainKey;
  readonly address: Address;
}

export const MAIN_STACK: readonly ContractRow[] = [
  { name: "ArbReactive", chain: "lasna", address: ADDRESSES.arbReactive },
  { name: "ArbExecutor", chain: "base", address: ADDRESSES.arbExecutor },
  { name: "Pool A", chain: "base", address: ADDRESSES.poolA },
  { name: "Pool B", chain: "base", address: ADDRESSES.poolB },
  { name: "Test WETH", chain: "base", address: ADDRESSES.weth },
  { name: "Test USDC", chain: "base", address: ADDRESSES.usdc },
];

export const COMPARISON_STACK: readonly ContractRow[] = [
  { name: "ArbReactive, no filter", chain: "lasna", address: "0x82DEA86F73edF0CC76cd2Ff4Ae8612380e63CE6F" },
  { name: "ArbExecutor", chain: "base", address: "0x9429334cBda1E85Cd99691aE4f0BBca2786d597C" },
  { name: "Pool A", chain: "base", address: "0x97898610adD7F402C9D6612e5cF69e395eba7AC0" },
  { name: "Pool B", chain: "base", address: "0xE4140Ea6a6152F6F0cf02D13a56B7A7F60781105" },
];
