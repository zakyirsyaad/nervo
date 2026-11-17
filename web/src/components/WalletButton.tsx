"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

interface WalletButtonProps {
  /** Renders the full-width primary variant used inside panels. */
  block?: boolean;
}

export function WalletButton({ block = false }: WalletButtonProps) {
  const sizeClass = block ? "btn primary block" : "btn";

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
        if (chain.unsupported) {
          return (
            <button type="button" className={sizeClass} onClick={openChainModal}>
              Switch to Base Sepolia
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
