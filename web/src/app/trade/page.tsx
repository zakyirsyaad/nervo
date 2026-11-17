import type { Metadata } from "next";
import { TradeWorkspace } from "@/features/trade/TradeWorkspace";

export const metadata: Metadata = { title: "Trade" };

export default function TradePage() {
  return (
    <>
      <section className="section">
        <div className="container tight stack">
          <h1 className="h1">Try it yourself.</h1>
          <p className="body-lg">
            Swap on one pool and its price moves away from the other. Within about two seconds, a contract on another
            chain notices the difference and trades it back for a profit. You only sign the first swap; the rest
            happens by itself.
          </p>
        </div>
      </section>
      <section className="section">
        <TradeWorkspace />
      </section>
    </>
  );
}
