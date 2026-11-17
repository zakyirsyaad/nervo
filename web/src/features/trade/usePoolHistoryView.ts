"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { ADDRESSES } from "@/config/contracts";
import type { Reserves } from "@/lib/amm";
import { shortHex } from "@/lib/format";
import {
  buildLoops,
  buildPriceSteps,
  groupByTransaction,
  sameAddress,
  summarizeLoops,
  type LoopRow,
  type LoopSummary,
  type PoolKey,
  type PriceStep,
} from "./history";
import { HISTORY_HOURS, usePoolHistory } from "./useHistory";

const MAX_STEPS = 40;

export type HistoryStatus = "loading" | "error" | "empty" | "ready";

export interface PoolHistoryView {
  readonly status: HistoryStatus;
  /** A refresh failed while older data is still shown. */
  readonly isRefreshFailing: boolean;
  readonly steps: readonly PriceStep[];
  readonly rows: readonly LoopRow[];
  readonly summary: LoopSummary;
  readonly nowSeconds: number;
  /** "the last 5 hours", for empty and loading text. */
  readonly windowText: string;
  readonly describeStep: (step: PriceStep) => string;
  readonly retry: () => void;
}

/**
 * The pools' recent history, shaped for the trade and protect pages. With `focus`, the steps are the changes to that
 * pool only, picked from the whole window before the newest ones are kept.
 */
export function usePoolHistoryView(
  live: Partial<Record<PoolKey, Reserves>> | undefined,
  account: Address | undefined,
  focus?: PoolKey,
): PoolHistoryView {
  const { data, isError, isPending, refetch } = usePoolHistory();
  const txs = useMemo(() => (data ? groupByTransaction(data.logs) : []), [data]);
  const steps = useMemo(() => {
    if (!focus) return buildPriceSteps(txs, live, MAX_STEPS, ADDRESSES.arbExecutor);
    const all = buildPriceSteps(txs, live, txs.length, ADDRESSES.arbExecutor);
    return all.filter((step) => step.touches.includes(focus)).slice(-MAX_STEPS);
  }, [txs, live, focus]);
  const rows = useMemo(() => (data ? buildLoops(txs, live, ADDRESSES.arbExecutor, data.readAtSeconds) : []), [txs, live, data]);

  function describeStep(step: PriceStep): string {
    if (step.byContract) return "The contract's trade";
    if (!step.hasSwap) return "Reset by the pool owner";
    return sameAddress(step.actor, account) ? "Your swap" : `Swap by ${shortHex(step.actor)}`;
  }

  const status: HistoryStatus = data ? (txs.length === 0 ? "empty" : "ready") : isPending ? "loading" : isError ? "error" : "loading";

  return {
    status,
    isRefreshFailing: isError && data !== undefined,
    steps,
    rows,
    summary: summarizeLoops(rows),
    nowSeconds: data?.readAtSeconds ?? 0,
    windowText: `the last ${HISTORY_HOURS} hours`,
    describeStep,
    retry: () => void refetch(),
  };
}
