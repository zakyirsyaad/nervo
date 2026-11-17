import type { Decision, Outcome } from "@/config/abis";

interface ReceiptLog {
  readonly address: string;
  readonly topics: readonly string[];
  readonly logIndex: number;
}

/** Log index of the pool's ReserveUpdate event, the log ArbReactive reacts to. */
export function findTriggerLog(logs: readonly ReceiptLog[], pool: string, reserveUpdateTopic: string): number | null {
  const match = logs.find(
    (log) => log.address.toLowerCase() === pool.toLowerCase() && log.topics[0] === reserveUpdateTopic,
  );
  return match ? match.logIndex : null;
}

function isHexString(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
}

/** Reads a raw eth_getBlockByNumber result. Base Sepolia adds a non-standard `timestampMs`. */
export function blockTimestampMs(block: unknown): number | null {
  if (typeof block !== "object" || block === null) return null;
  const fields = block as Record<string, unknown>;
  if (isHexString(fields.timestampMs)) return Number(BigInt(fields.timestampMs));
  if (isHexString(fields.timestamp)) return Number(BigInt(fields.timestamp)) * 1000;
  return null;
}

export interface LoopState {
  readonly decision: Decision | undefined;
  readonly outcome: Outcome | undefined;
  readonly hasDecisionTimedOut: boolean;
  readonly hasOutcomeTimedOut: boolean;
  /** A chain read failed after retries. */
  readonly hasError: boolean;
}

export type LoopStatusKind =
  | "waiting-decision"
  | "waiting-callback"
  | "executed"
  | "skipped"
  | "rejected"
  | "decision-timeout"
  | "callback-timeout"
  | "error";

export interface LoopStatus {
  readonly kind: LoopStatusKind;
  readonly label: string;
  readonly isFinal: boolean;
}

const STATUS: Record<LoopStatusKind, LoopStatus> = {
  "waiting-decision": { kind: "waiting-decision", label: "Checking the price gap", isFinal: false },
  "waiting-callback": { kind: "waiting-callback", label: "Trade on its way", isFinal: false },
  executed: { kind: "executed", label: "Trade done", isFinal: true },
  skipped: { kind: "skipped", label: "Trade skipped", isFinal: true },
  rejected: { kind: "rejected", label: "Gap too small", isFinal: true },
  "decision-timeout": { kind: "decision-timeout", label: "No response yet", isFinal: true },
  "callback-timeout": { kind: "callback-timeout", label: "Trade delayed", isFinal: true },
  error: { kind: "error", label: "Connection problem", isFinal: true },
};

export function loopStatus(state: LoopState): LoopStatus {
  if (state.outcome === "Executed") return STATUS.executed;
  if (state.outcome) return STATUS.skipped;
  if (state.decision && state.decision !== "CallbackRequested") return STATUS.rejected;
  if (state.hasError) return STATUS.error;
  if (!state.decision) return state.hasDecisionTimedOut ? STATUS["decision-timeout"] : STATUS["waiting-decision"];
  return state.hasOutcomeTimedOut ? STATUS["callback-timeout"] : STATUS["waiting-callback"];
}
