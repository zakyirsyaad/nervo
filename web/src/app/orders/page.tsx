import type { Metadata } from "next";
import { ContractTable } from "@/components/ContractTable";
import { ORDER_CONTRACTS } from "@/config/orders";
import { OrdersWorkspace } from "@/features/orders/OrdersWorkspace";

export const metadata: Metadata = { title: "Protect" };

// OrderReactive and the faucet sit at the same address on purpose (see ORDER_STACK in config/orders.ts).
const SHARED_ADDRESS_NOTE =
  "OrderReactive and the faucet share an address on purpose. A contract's address comes from the deployer and how many transactions it has sent, and both were deployed at the same count, on two different chains.";

export default function OrdersPage() {
  return (
    <>
      <section className="section">
        <div className="container tight stack">
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
            <h2 className="h2">The contracts behind it.</h2>
            <p className="muted">
              The order book holds your tokens on Unichain Sepolia. The Reactive contract on Lasna reads the price on
              Base Sepolia and tells the order book when to trade.
            </p>
          </div>
          <ContractTable rows={ORDER_CONTRACTS} note={SHARED_ADDRESS_NOTE} />
        </div>
      </section>
    </>
  );
}
