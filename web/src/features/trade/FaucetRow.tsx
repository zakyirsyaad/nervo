"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useConfig } from "wagmi";
import { readContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { faucetAbi } from "@/config/abis";
import { BASE_SEPOLIA_FAUCET_URL, originChain } from "@/config/chains";
import { FAUCET_ADDRESS } from "@/config/contracts";
import { describeTxError } from "./errors";
import type { WalletState } from "./useWallet";
import styles from "./trade.module.css";

interface FaucetRowProps {
  wallet: WalletState;
}

export function FaucetRow({ wallet }: FaucetRowProps) {
  const config = useConfig();
  const [isClaiming, setIsClaiming] = useState(false);
  const [error, setError] = useState<string>();
  // The clock is read inside the query, not during render, so the page can still be prerendered.
  const { data: isCoolingDown, refetch } = useQuery({
    queryKey: ["faucet-cooldown", FAUCET_ADDRESS, wallet.account],
    queryFn: async () => {
      const nextClaimAt = await readContract(config, {
        address: FAUCET_ADDRESS!,
        abi: faucetAbi,
        functionName: "nextClaimAt",
        args: [wallet.account!],
        chainId: originChain.id,
      });
      return nextClaimAt > BigInt(Math.floor(Date.now() / 1000));
    },
    enabled: Boolean(FAUCET_ADDRESS && wallet.account),
  });
  // Undefined while the cooldown is still being read: the button stays disabled until it is known.
  const canClaim = isCoolingDown === false && !wallet.isWrongNetwork && !isClaiming;

  async function handleClaim() {
    if (!FAUCET_ADDRESS) return;
    setError(undefined);
    setIsClaiming(true);
    try {
      const hash = await writeContract(config, {
        account: wallet.account,
        address: FAUCET_ADDRESS,
        abi: faucetAbi,
        functionName: "claim",
        chainId: originChain.id,
      });
      const receipt = await waitForTransactionReceipt(config, { hash, chainId: originChain.id });
      if (receipt.status !== "success") {
        setError("The claim transaction reverted. No tokens were sent.");
        return;
      }
      wallet.refetch();
      await refetch();
    } catch (caught: unknown) {
      setError(describeTxError(caught));
    } finally {
      setIsClaiming(false);
    }
  }

  return (
    <div className={`panel-row ${styles.faucet}`}>
      <div className="label">Test tokens</div>
      <p className="small muted">
        Need tokens to try this? Get 10,000 test USDC and 5 test WETH for free, once a day. They are play money with
        no real value. You also need a little Base Sepolia ETH to pay network fees.
      </p>
      <div className={styles.faucetActions}>
        <button type="button" className="btn" disabled={!canClaim} onClick={handleClaim}>
          {faucetLabel({ isClaiming, isCoolingDown, isConnected: Boolean(wallet.account) })}
        </button>
        <a href={BASE_SEPOLIA_FAUCET_URL} target="_blank" rel="noreferrer" className="link-row">
          Get free Base Sepolia ETH ↗
        </a>
      </div>
      {error ? (
        <p role="alert" className="small danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface FaucetLabelInput {
  isClaiming: boolean;
  isCoolingDown: boolean | undefined;
  isConnected: boolean;
}

function faucetLabel({ isClaiming, isCoolingDown, isConnected }: FaucetLabelInput): string {
  if (!FAUCET_ADDRESS) return "Test tokens are not available yet";
  if (!isConnected) return "Connect wallet to get tokens";
  if (isClaiming) return "Sending tokens…";
  if (isCoolingDown === undefined) return "Checking…";
  if (isCoolingDown) return "Already claimed today";
  return "Get test tokens";
}
