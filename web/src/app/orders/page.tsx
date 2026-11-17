import type { Metadata } from "next";
import { ContractTable } from "@/components/ContractTable";
import { ORDER_CONTRACTS } from "@/config/orders";
import { OrdersWorkspace } from "@/features/orders/OrdersWorkspace";

export const metadata: Metadata = { title: "Protect" };

export default function OrdersPage() {
  return (
    <>
      <section className="section">
        <div className="container tight stack">
          <div className="label">[ Protect ]</div>
          <h1 className="h1">A stop-loss that watches another chain.</h1>
          <p className="body-lg">
            Set a stop-loss on Unichain Sepolia that reacts to the price on Base Sepolia. When the price gets there, a
            contract on the Reactive network makes your order trade by itself within seconds, with no bot or server.
          </p>
        </div>
      </section>
      <section className="section">
        <OrdersWorkspace />
      </section>
      <section className="section">
        <div className="container stack loose">
          <div className="stack">
            <div className="label">[ Check it yourself ]</div>
            <h2 className="h2">The contracts behind it.</h2>
            <p className="muted">
              The order book holds your tokens on Unichain Sepolia. The Reactive contract on Lasna reads the price on
              Base Sepolia and tells the order book when to trade.
            </p>
          </div>
          <ContractTable rows={ORDER_CONTRACTS} />
        </div>
      </section>
    </>
  );
}
