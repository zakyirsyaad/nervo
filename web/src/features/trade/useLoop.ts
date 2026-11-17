"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address, Hex } from "viem";
import { loopStatus, type LoopStatus } from "./loop";
import {
  fetchTrigger,
  waitForDecision,
  waitForOutcome,
  type DecisionRecord,
  type OutcomeRecord,
  type Trigger,
} from "./tracker";

export interface TrackedSwap {
  readonly txHash: Hex;
  readonly pool: Address;
}

export interface LoopView {
  readonly trigger: Trigger | undefined;
  readonly decision: DecisionRecord | undefined;
  readonly outcome: OutcomeRecord | undefined;
  readonly status: LoopStatus;
  /** Looks again after a timeout or a failed read. */
  readonly retry: () => void;
}

const NEVER_STALE = { staleTime: Infinity, gcTime: Infinity, retry: 2 } as const;

/** Follows one swap through the Lasna decision and the Base Sepolia callback. */
export function useLoop(swap: TrackedSwap | undefined): LoopView {
  const trigger = useQuery({
    queryKey: ["loop-trigger", swap?.txHash],
    queryFn: () => fetchTrigger(swap!.txHash, swap!.pool),
    enabled: Boolean(swap),
    ...NEVER_STALE,
  });

  const decision = useQuery({
    queryKey: ["loop-decision", trigger.data?.opportunityId],
    queryFn: ({ signal }) => waitForDecision(trigger.data!, signal),
    enabled: Boolean(trigger.data),
    ...NEVER_STALE,
  });

  const isCallbackRequested = decision.data?.decision === "CallbackRequested";
  const outcome = useQuery({
    queryKey: ["loop-outcome", trigger.data?.opportunityId],
    queryFn: ({ signal }) => waitForOutcome(trigger.data!, signal),
    enabled: Boolean(trigger.data) && isCallbackRequested,
    ...NEVER_STALE,
  });

  // While a query is fetching again, its previous timeout or error no longer describes the state.
  const hasDecisionTimedOut = decision.data === null && !decision.isFetching;
  const hasOutcomeTimedOut = outcome.data === null && !outcome.isFetching;
  const steps = [trigger, decision, outcome];

  function retry() {
    if (trigger.isError) void trigger.refetch();
    if (decision.isError || decision.data === null) void decision.refetch();
    if (outcome.isError || outcome.data === null) void outcome.refetch();
  }

  return {
    trigger: trigger.data,
    decision: decision.data ?? undefined,
    outcome: outcome.data ?? undefined,
    retry,
    status: loopStatus({
      decision: decision.data?.decision,
      outcome: outcome.data?.outcome,
      hasDecisionTimedOut,
      hasOutcomeTimedOut,
      hasError: steps.some((step) => step.isError && !step.isFetching),
    }),
  };
}
