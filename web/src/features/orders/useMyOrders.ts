"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { ORDER_STACK } from "@/config/orders";
import { loadOrderCache, rememberOrder, saveOrderCache } from "./orderCache";
import { mergeOrderRefs, type OrderRef, type OrderView } from "./orderList";
import { readOrderViews, readWatchedCount, scanPlacedOrders } from "./scan";

const SCAN_INTERVAL_MS = 15_000;
const STATUS_INTERVAL_MS = 4_000;
const WATCHED_INTERVAL_MS = 10_000;

export interface MyOrders {
  /** Orders newest first, with their current state. Undefined while loading. */
  readonly orders: readonly OrderView[] | undefined;
  /** Orders found, before their state is read; used to follow the newest one. */
  readonly refs: readonly OrderRef[] | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  /** Orders the Reactive contract watches for this wallet, when Lasna could be read. */
  readonly watchedCount: number | undefined;
  /** Adds an order placed from this page right away, before the next scan. */
  readonly remember: (ref: OrderRef) => void;
  readonly refresh: () => void;
}

/** The connected wallet's orders: OrderPlaced logs filtered by owner, plus the ids this browser remembers. */
export function useMyOrders(account: Address | undefined, isDeployed: boolean): MyOrders {
  const queryClient = useQueryClient();
  const refsKey = ["order-refs", ORDER_STACK.orderBook, account] as const;

  const refs = useQuery({
    queryKey: refsKey,
    queryFn: async () => {
      const owner = account!;
      const scanned = await scanPlacedOrders(owner, loadOrderCache(owner));
      // Merge with a fresh read, so an order remembered while the scan ran is kept.
      const merged = { scannedTo: scanned.scannedTo, refs: mergeOrderRefs(scanned.refs, loadOrderCache(owner).refs) };
      saveOrderCache(owner, merged);
      return merged.refs;
    },
    enabled: Boolean(account) && isDeployed,
    refetchInterval: SCAN_INTERVAL_MS,
  });

  const found = refs.data ?? [];
  const views = useQuery({
    queryKey: ["order-views", ORDER_STACK.orderBook, account, found.map((ref) => ref.id.toString()).join(",")],
    queryFn: () => readOrderViews(found),
    enabled: found.length > 0,
    refetchInterval: STATUS_INTERVAL_MS,
    placeholderData: keepPreviousData,
  });

  const watched = useQuery({
    queryKey: ["order-watched", ORDER_STACK.orderReactive, account],
    queryFn: () => readWatchedCount(account!),
    enabled: Boolean(account) && isDeployed,
    refetchInterval: WATCHED_INTERVAL_MS,
    retry: 1,
  });

  function remember(ref: OrderRef) {
    if (!account) return;
    rememberOrder(account, ref);
    queryClient.setQueryData<OrderRef[]>(refsKey, (old) => mergeOrderRefs([ref], old ?? []));
  }

  function refresh() {
    void refs.refetch();
    void views.refetch();
    void watched.refetch();
  }

  return {
    orders: refs.data && refs.data.length === 0 ? [] : views.data,
    refs: refs.data,
    isLoading: refs.isPending || (found.length > 0 && views.isPending),
    isError: refs.isError || views.isError,
    watchedCount: watched.data,
    remember,
    refresh,
  };
}
