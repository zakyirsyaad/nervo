import type { Config } from "wagmi";
import { getAccount, switchChain } from "wagmi/actions";
import { orderChain } from "@/config/chains";

/** Asks the wallet to move to Unichain Sepolia unless it is already there. Wallets that lack it are offered to add it. */
export async function ensureOrderChain(config: Config): Promise<void> {
  if (getAccount(config).chainId === orderChain.id) return;
  await switchChain(config, { chainId: orderChain.id });
}
