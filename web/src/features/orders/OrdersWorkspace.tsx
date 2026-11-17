"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ORDER_STACK } from "@/config/orders";
import { OrderForm } from "./OrderForm";
import { canCancel, type OrderRef } from "./orderList";
import { OrdersPanel } from "./OrdersPanel";
import { OrderTracker } from "./OrderTracker";
import { PricePanel } from "./PricePanel";
import { useCancelOrder } from "./useCancelOrder";
import { useMyOrders } from "./useMyOrders";
import { useOrderContracts } from "./useOrderContracts";
import { useOrderPrices } from "./useOrderPrices";
import { useOrderTrail } from "./useOrderTrail";
import { useOrderWallet } from "./useOrderWallet";
import tradeStyles from "../trade/trade.module.css";

export function OrdersWorkspace() {
  const queryClient = useQueryClient();
  const contracts = useOrderContracts();
  const prices = useOrderPrices(contracts.isDeployed);
  const wallet = useOrderWallet(contracts.isDeployed);
  const myOrders = useMyOrders(wallet.account, contracts.isDeployed);
  const cancel = useCancelOrder();
  const [selectedId, setSelectedId] = useState<bigint>();

  // Follows the order picked in the list, or the newest one.
  const refs = myOrders.refs ?? [];
  const selected = refs.find((ref) => ref.id === selectedId) ?? refs[0];
  const trail = useOrderTrail(selected);
  const selectedView = trail.snapshot?.order ?? myOrders.orders?.find((view) => view.ref.id === selected?.id);

  function handlePlaced(order: OrderRef) {
    myOrders.remember(order);
    setSelectedId(order.id);
  }

  async function handleCancel(orderId: bigint) {
    if (!wallet.account) return;
    const isCancelled = await cancel.cancel(wallet.account, orderId);
    if (!isCancelled) return;
    wallet.refetch();
    myOrders.refresh();
    void queryClient.invalidateQueries({ queryKey: ["order-trail", ORDER_STACK.orderBook, orderId.toString()] });
  }

  return (
    <div className={`container ${tradeStyles.workspace}`}>
      <div className={tradeStyles.left}>
        <OrderForm
          contracts={contracts}
          prices={prices}
          wallet={wallet}
          watchedCount={myOrders.watchedCount}
          onPlaced={handlePlaced}
        />
      </div>
      <div className={tradeStyles.right}>
        <PricePanel prices={prices} deployment={contracts.deployment} />
        <OrdersPanel
          account={wallet.account}
          deployment={contracts.deployment}
          myOrders={myOrders}
          selectedId={selected?.id}
          onSelect={(order) => setSelectedId(order.id)}
          cancel={cancel}
          onCancel={(orderId) => void handleCancel(orderId)}
        />
        <OrderTracker
          order={selected}
          trail={trail}
          canCancel={selectedView ? canCancel(selectedView, wallet.account) : false}
          isCancelling={selected !== undefined && cancel.cancellingId === selected.id}
          cancelError={selected !== undefined && cancel.error?.orderId === selected.id ? cancel.error.message : undefined}
          onCancel={() => selected && void handleCancel(selected.id)}
        />
      </div>
    </div>
  );
}
