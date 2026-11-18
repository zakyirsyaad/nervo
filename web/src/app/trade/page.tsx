import type { Metadata } from "next";
import { pageMetadata } from "@/config/site";
import { TradeWorkspace } from "@/features/trade/TradeWorkspace";

export const metadata: Metadata = pageMetadata({
  title: "Trade",
  description:
    "Swap on a Base Sepolia test pool to open a price gap, then watch a Reactive contract on Lasna trade it back. Claim test tokens from the faucet on this page.",
  path: "/trade",
});

export default function TradePage() {
  return (
    <section className="section">
      <TradeWorkspace />
    </section>
  );
}
