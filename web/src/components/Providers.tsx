"use client";

import { darkTheme, getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { http, WagmiProvider } from "wagmi";
import { BASE_SEPOLIA_RPC_URL, orderChain, originChain, UNICHAIN_SEPOLIA_RPC_URL } from "@/config/chains";

// Without a WalletConnect project id only browser-extension wallets can connect.
const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID || "arb-loop-no-walletconnect";

const wagmiConfig = getDefaultConfig({
  appName: "Arb Loop",
  projectId: WALLETCONNECT_PROJECT_ID,
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
