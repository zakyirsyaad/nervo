"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ORDER_STACK } from "@/config/orders";
import { shortHex } from "@/lib/format";
import { revealIfOffscreen } from "@/lib/reveal";
import { sameAddress } from "../trade/history";
import { usePoolHistoryView } from "../trade/usePoolHistoryView";
import { firedSteps } from "./orderBook";
import { OrderBookSection } from "./OrderBookSection";
import { OrderForm } from "./OrderForm";
import { canCancel, type OrderRef } from "./orderList";
import { OrdersPanel } from "./OrdersPanel";
import { OrderTracker } from "./OrderTracker";
import { PricePanel } from "./PricePanel";
import { TriggerSection } from "./TriggerSection";
import { useCancelOrder } from "./useCancelOrder";
import { useMyOrders } from "./useMyOrders";
import { useOrderBook } from "./useOrderBook";
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
  const book = useOrderBook(contracts.isDeployed);
  const live = useMemo(() => (prices.base ? { A: prices.base } : undefined), [prices.base]);
  // Orders watch Pool A only, so the chart takes the newest changes to Pool A from the whole window.
  const history = usePoolHistoryView(live, wallet.account, "A");
  const fired = useMemo(() => firedSteps(history.steps, book.outcomes), [history.steps, book.outcomes]);
  const cancel = useCancelOrder();
  // The followed order is kept as a ref, so it stays put when newer orders push it out of either list.
  const [selectedRef, setSelectedRef] = useState<OrderRef>();
  const trackerRef = useRef<HTMLDivElement>(null);

  // Until someone picks an order: this wallet's newest, else the newest on the book once the wallet's own list has
  // loaded (or there is no wallet). Pinned once, so the tracker never jumps to an order someone else just placed.
  const refs = myOrders.refs ?? [];
  const hasWalletList = !wallet.account || myOrders.refs !== undefined;
  const fallback = refs[0] ?? (hasWalletList ? book.refs[0] : undefined);
  // Set during render, React's pattern for state that follows other data, so the pin lands before paint.
  if (!selectedRef && fallback) setSelectedRef(fallback);
  const selected = selectedRef ?? fallback;

  const trail = useOrderTrail(selected);
  const selectedView =
    trail.snapshot?.order ??
    myOrders.orders?.find((view) => view.ref.id === selected?.id) ??
    book.rows.find((row) => row.view.ref.id === selected?.id)?.view;
  const trigger = selectedView ? { orderId: selectedView.ref.id, price: selectedView.triggerPrice } : undefined;
  const isOwn =
    selected !== undefined &&
    (refs.some((ref) => ref.id === selected.id) || (selectedView !== undefined && sameAddress(selectedView.owner, wallet.account)));

  // Set only by a new order, so picking an existing order from the list does not scroll the page.
  const [placedId, setPlacedId] = useState<bigint>();

  // After the commit, so the tracker is measured below the order row the new order adds above it.
  useEffect(() => {
    if (placedId !== undefined) revealIfOffscreen(trackerRef.current);
  }, [placedId]);

  function handlePlaced(order: OrderRef) {
    myOrders.remember(order);
    setSelectedRef(order);
    setPlacedId(order.id);
  }

  function follow(id: bigint) {
    const ref = refs.find((item) => item.id === id) ?? book.refs.find((item) => item.id === id);
    if (ref) setSelectedRef(ref);
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
    <div className={`container ${tradeStyles.page}`}>
      <div className={tradeStyles.workspace}>
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
          <PricePanel prices={prices} deployment={contracts.deployment}>
            <TriggerSection view={history} steps={history.steps} fired={fired} trigger={trigger} />
          </PricePanel>
          <div ref={trackerRef} className={tradeStyles.reveal}>
            <OrderTracker
              order={selected}
              isOwn={isOwn}
              ownerLabel={selectedView ? shortHex(selectedView.owner) : undefined}
              trail={trail}
              canCancel={selectedView ? canCancel(selectedView, wallet.account) : false}
              isCancelling={selected !== undefined && cancel.cancellingId === selected.id}
              cancelError={selected !== undefined && cancel.error?.orderId === selected.id ? cancel.error.message : undefined}
              onCancel={() => selected && void handleCancel(selected.id)}
            />
          </div>
          <OrdersPanel
            account={wallet.account}
            deployment={contracts.deployment}
            myOrders={myOrders}
            selectedId={selected?.id}
            onSelect={(order) => follow(order.id)}
            cancel={cancel}
            onCancel={(orderId) => void handleCancel(orderId)}
          />
        </div>
      </div>
      <OrderBookSection book={book} account={wallet.account} followedId={selected?.id} onFollow={follow} />
    </div>
  );
}
