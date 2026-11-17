"use client";

import {
  darkTheme,
  getDefaultConfig,
  RainbowKitProvider,
  type Wallet,
  type WalletList,
} from "@rainbow-me/rainbowkit";
import { base, injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { http, WagmiProvider } from "wagmi";
import { BASE_SEPOLIA_RPC_URL, orderChain, originChain, UNICHAIN_SEPOLIA_RPC_URL } from "@/config/chains";

const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID;

/**
 * The generic browser-extension wallet, listed only when an extension is present. RainbowKit hides a wallet
 * marked not installed; without this, picking it with no extension waits on a spinner forever.
 */
function browserWallet(): Wallet {
  const hasExtension = typeof window !== "undefined" && "ethereum" in window;
  return { ...injectedWallet(), installed: hasExtension };
}

/**
 * Without a WalletConnect project id, RainbowKit's default list still shows Rainbow, MetaMask (without its
 * extension) and WalletConnect, which open a QR flow that never loads. Offer only the wallets that work
 * without it: an installed extension, and Base's own popup wallet.
 */
const WALLETS_WITHOUT_WALLETCONNECT: WalletList = [
  { groupName: "Works in this browser", wallets: [browserWallet, base] },
];

const wagmiConfig = getDefaultConfig({
  appName: "Nervo",
  // getDefaultConfig requires a value; it is never sent anywhere when no WalletConnect wallet is listed.
  projectId: WALLETCONNECT_PROJECT_ID || "unused-without-walletconnect",
  wallets: WALLETCONNECT_PROJECT_ID ? undefined : WALLETS_WITHOUT_WALLETCONNECT,
  // Base Sepolia for the arbitrage loop, Unichain Sepolia for protective orders.
  chains: [originChain, orderChain],
  transports: {
    [originChain.id]: http(BASE_SEPOLIA_RPC_URL),
    [orderChain.id]: http(UNICHAIN_SEPOLIA_RPC_URL),
  },
  ssr: true,
});

const rainbowTheme = darkTheme({
  accentColor: "#ededed",
  accentColorForeground: "#000000",
  borderRadius: "small",
  fontStack: "system",
  overlayBlur: "none",
});

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={rainbowTheme} initialChain={originChain}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
