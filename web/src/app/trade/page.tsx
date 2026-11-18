import type { Metadata } from "next";
import { TradeWorkspace } from "@/features/trade/TradeWorkspace";

export const metadata: Metadata = { title: "Trade" };

export default function TradePage() {
  return (
    <section className="section">
      <TradeWorkspace />
    </section>
  );
}
