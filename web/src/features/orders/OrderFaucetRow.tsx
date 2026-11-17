"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useConfig } from "wagmi";
import { readContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { faucetAbi } from "@/config/abis";
import { orderChain, UNICHAIN_SEPOLIA_FAUCET_URL } from "@/config/chains";
import { ORDER_STACK } from "@/config/orders";
import { describeTxError } from "@/features/trade/errors";
import { ensureOrderChain } from "./network";
import type { OrderWallet } from "./useOrderWallet";
import tradeStyles from "../trade/trade.module.css";

interface OrderFaucetRowProps {
  wallet: OrderWallet;
  isDeployed: boolean;
}

/** Test-token faucet on Unichain Sepolia. Same contract as the Base one, with separate tokens. */
export function OrderFaucetRow({ wallet, isDeployed }: OrderFaucetRowProps) {
  const config = useConfig();
  const [isClaiming, setIsClaiming] = useState(false);
  const [error, setError] = useState<string>();
  // The clock is read inside the query, not during render, so the page can still be prerendered.
  const { data: isCoolingDown, refetch } = useQuery({
    queryKey: ["order-faucet-cooldown", ORDER_STACK.faucet, wallet.account],
    queryFn: async () => {
      const nextClaimAt = await readContract(config, {
        address: ORDER_STACK.faucet,
        abi: faucetAbi,
        functionName: "nextClaimAt",
        args: [wallet.account!],
        chainId: orderChain.id,
      });
      return nextClaimAt > BigInt(Math.floor(Date.now() / 1000));
    },
    enabled: isDeployed && Boolean(wallet.account),
  });
  // Undefined while the cooldown is still being read: the button stays disabled until it is known.
  const canClaim = isCoolingDown === false && !isClaiming;

  async function handleClaim() {
    setError(undefined);
    setIsClaiming(true);
    try {
      await ensureOrderChain(config);
      const hash = await writeContract(config, {
        account: wallet.account,
        address: ORDER_STACK.faucet,
        abi: faucetAbi,
        functionName: "claim",
        chainId: orderChain.id,
      });
      const receipt = await waitForTransactionReceipt(config, { hash, chainId: orderChain.id });
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
    <div className={`panel-row ${tradeStyles.faucet}`}>
      <div className="label">[ Test tokens on Unichain ]</div>
      <p className="small muted">
        Need tokens to try this? Get 10,000 test USDC and 5 test WETH on Unichain Sepolia for free, once a day. They are
        separate from the Base Sepolia test tokens and have no real value. You also need a little Unichain Sepolia ETH
        for network fees and the trigger fee.
      </p>
      <div className={tradeStyles.faucetActions}>
        <button type="button" className="btn" disabled={!canClaim} onClick={handleClaim}>
          {faucetLabel({ isDeployed, isClaiming, isCoolingDown, isConnected: Boolean(wallet.account) })}
        </button>
        <a href={UNICHAIN_SEPOLIA_FAUCET_URL} target="_blank" rel="noopener noreferrer" className="link-row">
          Get Unichain Sepolia ETH ↗
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
  isDeployed: boolean;
  isClaiming: boolean;
  isCoolingDown: boolean | undefined;
  isConnected: boolean;
}

function faucetLabel({ isDeployed, isClaiming, isCoolingDown, isConnected }: FaucetLabelInput): string {
  if (!isDeployed) return "Test tokens are not available yet";
  if (!isConnected) return "Connect wallet to get tokens";
  if (isClaiming) return "Sending tokens…";
  if (isCoolingDown === undefined) return "Checking…";
  if (isCoolingDown) return "Already claimed today";
  return "Get test tokens on Unichain";
}
