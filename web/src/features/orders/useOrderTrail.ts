"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ORDER_STACK } from "@/config/orders";
import type { OrderRef } from "./orderList";
import { EMPTY_TRAIL, trailStatus, trailSteps, type TrailState, type TrailStatus, type TrailSteps } from "./trail";
import { fetchTrailSnapshot, type TrailSnapshot } from "./trailFetch";

const POLL_INTERVAL_MS = 2_000;

export interface OrderTrailView {
  readonly snapshot: TrailSnapshot | undefined;
  readonly status: TrailStatus;
  readonly steps: TrailSteps;
  readonly isLoading: boolean;
  /** Starts the Reactive timeout again and looks once more. */
  readonly keepWaiting: () => void;
  /** Reads again now, e.g. after a failed read or a cancel. */
  readonly refresh: () => void;
}

function stateOf(snapshot: TrailSnapshot | undefined, hasError: boolean): TrailState {
  return {
    trail: snapshot?.trail ?? EMPTY_TRAIL,
    orderStatus: snapshot?.order.status,
    isExpired: snapshot?.order.isExpired ?? false,
    hasMirrorTimedOut: snapshot?.hasMirrorTimedOut ?? false,
    hasError,
  };
}

/**
 * Follows one order across Unichain Sepolia and Lasna. Each poll reads only the blocks added since the previous
 * snapshot, and polling stops once nothing more can happen without the visitor.
 */
export function useOrderTrail(order: OrderRef | undefined): OrderTrailView {
  const queryClient = useQueryClient();
  const queryKey = ["order-trail", ORDER_STACK.orderBook, order?.id.toString()] as const;

  const query = useQuery({
    queryKey,
    queryFn: () => fetchTrailSnapshot(order!, queryClient.getQueryData<TrailSnapshot>(queryKey)),
    enabled: Boolean(order),
    retry: 2,
    refetchInterval: (current) =>
      current.state.data && trailStatus(stateOf(current.state.data, false)).isSettled ? false : POLL_INTERVAL_MS,
  });

  // While a read is running again, an earlier failure no longer describes the state.
  const state = stateOf(query.data, query.isError && !query.isFetching);

  function keepWaiting() {
    queryClient.setQueryData<TrailSnapshot>(queryKey, (previous) =>
      previous ? { ...previous, startedAtMs: Date.now(), hasMirrorTimedOut: false } : previous,
    );
    void query.refetch();
  }

  return {
    snapshot: query.data,
    status: trailStatus(state),
    steps: trailSteps(state),
    isLoading: Boolean(order) && query.isPending,
    keepWaiting,
    refresh: () => void query.refetch(),
  };
}
