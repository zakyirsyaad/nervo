import type { Metadata } from "next";
import { ContractTable } from "@/components/ContractTable";
import { ORDER_CONTRACTS, ORDER_STACK } from "@/config/orders";
import { pageMetadata } from "@/config/site";
import { OrdersWorkspace } from "@/features/orders/OrdersWorkspace";

export const metadata: Metadata = pageMetadata({
  title: "Protect",
  description:
    "Place a stop-loss, take-profit or limit buy on Unichain Sepolia that fires on the Base price, with no bot running. Follow each order from placement to fill.",
  path: "/orders",
});

// Shown only while the two really share an address, so a redeploy at other nonces drops it by itself.
const SHARED_ADDRESS_NOTE =
  ORDER_STACK.orderReactive.toLowerCase() === ORDER_STACK.faucet.toLowerCase()
    ? "OrderReactive and the faucet share an address on purpose. A contract's address comes from the deployer and how many transactions it has sent, and both were deployed at the same count, on two different chains."
    : undefined;

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
