import type { ReactNode } from "react";
import type { Address } from "viem";
import { MAX_WATCHED_PER_OWNER } from "@/config/orders";
import type { Deployment } from "./orderDraft";
import { canCancel, type OrderRef, type OrderView } from "./orderList";
import { OrderRow } from "./OrderRow";
import type { CancelController } from "./useCancelOrder";
import type { MyOrders } from "./useMyOrders";
import styles from "./orders.module.css";

interface OrdersPanelProps {
  account: Address | undefined;
  deployment: Deployment;
  myOrders: MyOrders;
  selectedId: bigint | undefined;
  onSelect: (order: OrderRef) => void;
  cancel: CancelController;
  onCancel: (orderId: bigint) => void;
}

const DEPLOYMENT_STATE: Record<Exclude<Deployment, "deployed">, string> = {
  checking: "Checking the order contracts…",
  missing: "The order contracts are not deployed on Unichain Sepolia yet, so there are no orders to show.",
  error: "Cannot reach Unichain Sepolia right now. Your orders will show up when it answers again.",
};

export function OrdersPanel({ account, deployment, myOrders, selectedId, onSelect, cancel, onCancel }: OrdersPanelProps) {
  const { watchedCount } = myOrders;

  return (
    <div className="panel">
      <div className="panel-head label">
        <span>Your orders</span>
        {watchedCount === undefined ? null : (
          <span className={watchedCount >= MAX_WATCHED_PER_OWNER ? "warn" : undefined}>
            {watchedCount} of {MAX_WATCHED_PER_OWNER} watched
          </span>
        )}
      </div>
      <OrdersBody
        account={account}
        deployment={deployment}
        myOrders={myOrders}
        renderRow={(view) => (
          <OrderRow
            key={view.ref.id.toString()}
            view={view}
            isSelected={view.ref.id === selectedId}
            canCancel={canCancel(view, account)}
            isCancelling={cancel.cancellingId === view.ref.id}
            isCancelBlocked={cancel.cancellingId !== undefined}
            error={cancel.error?.orderId === view.ref.id ? cancel.error.message : undefined}
            onSelect={() => onSelect(view.ref)}
            onCancel={() => onCancel(view.ref.id)}
          />
        )}
      />
      <p className="panel-row small faint">
        Lists the orders this wallet placed in about the last 14 hours, plus any placed from this browser. Pick one to
        follow it below.
      </p>
    </div>
  );
}

interface OrdersBodyProps {
  account: Address | undefined;
  deployment: Deployment;
  myOrders: MyOrders;
  renderRow: (view: OrderView) => ReactNode;
}

function OrdersBody({ account, deployment, myOrders, renderRow }: OrdersBodyProps) {
  if (deployment !== "deployed") return <StateRow text={DEPLOYMENT_STATE[deployment]} />;
  if (!account) return <StateRow text="Connect your wallet to see your orders." />;
  if (myOrders.isError && !myOrders.orders) {
    return (
      <div className={`panel-row ${styles.state}`}>
        <p role="alert" className="small danger">
          Could not read your orders from Unichain Sepolia.{" "}
          <button type="button" className={styles.textButton} onClick={myOrders.refresh}>
            Try again
          </button>
        </p>
      </div>
    );
  }
  if (myOrders.isLoading || !myOrders.orders) return <StateRow text="Looking for your orders…" isStatus />;
  if (myOrders.orders.length === 0) return <StateRow text="No orders yet. Place one with the form, and it shows up here." />;
  return <ul className={styles.list}>{myOrders.orders.map(renderRow)}</ul>;
}

interface StateRowProps {
  text: string;
  isStatus?: boolean;
}

function StateRow({ text, isStatus = false }: StateRowProps) {
  return (
    <p role={isStatus ? "status" : undefined} className={`panel-row small muted ${styles.state}`}>
      {text}
    </p>
  );
}
