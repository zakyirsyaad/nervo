"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useSwitchChain } from "wagmi";

interface WalletButtonProps {
  /** Renders the full-width primary variant used inside panels. */
  block?: boolean;
  /** Network the surrounding form sends transactions on. The button offers to switch to it. */
  requiredChain?: { id: number; name: string };
}

export function WalletButton({ block = false, requiredChain }: WalletButtonProps) {
  const sizeClass = block ? "btn primary block" : "btn";
  const { switchChain } = useSwitchChain();

  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
        if (!mounted || !account || !chain) {
          return (
            <button type="button" className={sizeClass} onClick={openConnectModal} disabled={!mounted}>
              Connect wallet
            </button>
          );
        }
        if (requiredChain && chain.id !== requiredChain.id) {
          return (
            <button type="button" className={sizeClass} onClick={() => switchChain({ chainId: requiredChain.id })}>
              Switch to {requiredChain.name}
            </button>
          );
        }
        if (chain.unsupported) {
          return (
            <button type="button" className={sizeClass} onClick={openChainModal}>
              Switch network
            </button>
          );
        }
        return (
          <button type="button" className={block ? sizeClass : "btn mono"} onClick={openAccountModal}>
            {account.displayName}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
