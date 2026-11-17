import type { Hex } from "viem";
import type { MirrorReason, MirrorState, OrderOutcome, OrderStatus } from "@/config/orderAbis";
import type { Tone } from "./labels";

// The events that follow one order: mirrored and triggered on Lasna, filled or cancelled on Unichain Sepolia.

interface LogPosition {
  readonly txHash: Hex;
  readonly blockNumber: bigint;
  readonly logIndex: number;
}

export interface MirrorRecord extends LogPosition {
  readonly state: MirrorState;
  readonly reason: MirrorReason;
}

export interface TriggerRecord extends LogPosition {
  /** Base Pool A price that met the condition, USDC base units per WETH. */
  readonly price: bigint;
  /** Base Sepolia block time of that price, in seconds. */
  readonly sourceTimestamp: bigint;
  readonly afterTimeout: boolean;
}

export interface OutcomeRecord extends LogPosition {
  readonly outcome: OrderOutcome;
  readonly amountOut: bigint;
  readonly observedPrice: bigint;
  /** Base Sepolia block time of the price that triggered the order, in seconds. */
  readonly sourceTimestamp: bigint;
  /** Unichain Sepolia block time of the outcome, in seconds. */
  readonly timestamp: bigint;
}

export type CancelRecord = LogPosition;

export interface OrderTrail {
  readonly mirrors: readonly MirrorRecord[];
  readonly triggers: readonly TriggerRecord[];
  readonly outcomes: readonly OutcomeRecord[];
  readonly cancels: readonly CancelRecord[];
}

export const EMPTY_TRAIL: OrderTrail = { mirrors: [], triggers: [], outcomes: [], cancels: [] };

function positionKey(log: LogPosition): string {
  return `${log.txHash}:${log.logIndex}`;
}

function byPosition(a: LogPosition, b: LogPosition): number {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  return a.logIndex - b.logIndex;
}

function mergeLogs<T extends LogPosition>(known: readonly T[], found: readonly T[] = []): readonly T[] {
  const seen = new Set(known.map(positionKey));
  const fresh = found.filter((log) => !seen.has(positionKey(log)));
  return fresh.length === 0 ? known : [...known, ...fresh].sort(byPosition);
}

/** A new trail with the events found in the latest scan added once each, in block order. */
export function appendTrail(trail: OrderTrail, found: Partial<OrderTrail>): OrderTrail {
  return {
    mirrors: mergeLogs(trail.mirrors, found.mirrors),
    triggers: mergeLogs(trail.triggers, found.triggers),
    outcomes: mergeLogs(trail.outcomes, found.outcomes),
    cancels: mergeLogs(trail.cancels, found.cancels),
  };
}

/** Seconds from the Base block whose price triggered the order to the Unichain block of its outcome. */
export function latencySeconds(outcome: Pick<OutcomeRecord, "sourceTimestamp" | "timestamp">): number {
  const seconds = outcome.timestamp - outcome.sourceTimestamp;
  return seconds > 0n ? Number(seconds) : 0;
}

function last<T>(list: readonly T[]): T | undefined {
  return list.length === 0 ? undefined : list[list.length - 1];
}

/** The first record Lasna wrote for the order: the result of its placement. */
export function placementMirror(trail: OrderTrail): MirrorRecord | undefined {
  return trail.mirrors[0];
}

export function latestOutcome(trail: OrderTrail): OutcomeRecord | undefined {
  return last(trail.outcomes);
}

export function latestTrigger(trail: OrderTrail): TriggerRecord | undefined {
  return last(trail.triggers);
}

export interface TrailState {
  readonly trail: OrderTrail;
  /** Status in the order book, when read. */
  readonly orderStatus: OrderStatus | undefined;
  readonly isExpired: boolean;
  readonly hasMirrorTimedOut: boolean;
  /** The latest read failed. */
  readonly hasError: boolean;
}

export type TrailKind =
  | "waiting-mirror"
  | "mirror-timeout"
  | "watching"
  | "triggered"
  | "retrying"
  | "filled"
  | "cancelled"
  | "expired"
  | "expired-open"
  | "not-watched"
  | "stopped"
  | "error";

export interface TrailStatus {
  readonly kind: TrailKind;
  readonly label: string;
  readonly tone: Tone;
  /** Nothing more will happen without the visitor, so polling stops. */
  readonly isSettled: boolean;
}

const STATUS: Record<TrailKind, TrailStatus> = {
  "waiting-mirror": { kind: "waiting-mirror", label: "Handing over to Reactive", tone: "warn", isSettled: false },
  "mirror-timeout": { kind: "mirror-timeout", label: "No response yet", tone: "danger", isSettled: true },
  watching: { kind: "watching", label: "Watching the price", tone: "accent", isSettled: false },
  triggered: { kind: "triggered", label: "Price reached, trading", tone: "warn", isSettled: false },
  retrying: { kind: "retrying", label: "Waiting to try again", tone: "warn", isSettled: false },
  filled: { kind: "filled", label: "Filled", tone: "ok", isSettled: true },
  cancelled: { kind: "cancelled", label: "Cancelled", tone: "muted", isSettled: true },
  expired: { kind: "expired", label: "Expired, refunded", tone: "muted", isSettled: true },
  "expired-open": { kind: "expired-open", label: "Expired", tone: "warn", isSettled: true },
  "not-watched": { kind: "not-watched", label: "Not watched", tone: "warn", isSettled: true },
  stopped: { kind: "stopped", label: "No longer watched", tone: "warn", isSettled: true },
  error: { kind: "error", label: "Connection problem", tone: "danger", isSettled: false },
};

const UNTRACKED_AT_PLACEMENT: readonly MirrorReason[] = ["PlacedUntracked", "OwnerLimit"];
const GAVE_UP: readonly MirrorReason[] = ["RetryLimit", "AttemptLimit", "Expired"];

/** Where the order stands, from the most final fact known down to what is still awaited. */
export function trailStatus({ trail, orderStatus, isExpired, hasMirrorTimedOut, hasError }: TrailState): TrailStatus {
  const outcome = latestOutcome(trail);
  const placement = placementMirror(trail);
  const latestMirror = last(trail.mirrors);

  if (outcome?.outcome === "Filled" || orderStatus === "Filled") return STATUS.filled;
  if (trail.cancels.length > 0 || orderStatus === "Cancelled") return STATUS.cancelled;
  if (outcome?.outcome === "SkippedExpired" || orderStatus === "Expired") return STATUS.expired;
  if (orderStatus === "Open" && isExpired) return STATUS["expired-open"];
  if (placement && UNTRACKED_AT_PLACEMENT.includes(placement.reason)) return STATUS["not-watched"];
  if (latestMirror?.state === "Closed" && GAVE_UP.includes(latestMirror.reason)) return STATUS.stopped;
  if (hasError) return STATUS.error;
  if (!placement) return hasMirrorTimedOut ? STATUS["mirror-timeout"] : STATUS["waiting-mirror"];
  if (trail.triggers.length > trail.outcomes.length) return STATUS.triggered;
  if (outcome?.outcome === "SkippedSlippage") return STATUS.retrying;
  return STATUS.watching;
}

export type StepState = "done" | "active" | "pending" | "off";

export interface TrailSteps {
  readonly mirror: StepState;
  readonly trigger: StepState;
  readonly outcome: StepState;
}

/** State of steps 2 to 4 of the tracker. Step 1, the placement, is always done. */
export function trailSteps(state: TrailState): TrailSteps {
  const status = trailStatus(state);
  if (status.kind === "mirror-timeout") return { mirror: "off", trigger: "pending", outcome: "pending" };

  const placement = placementMirror(state.trail);
  const isWatched = placement !== undefined && !UNTRACKED_AT_PLACEMENT.includes(placement.reason);
  const hasEnded = placement !== undefined || status.isSettled;
  return {
    mirror: isWatched ? "done" : hasEnded ? "off" : "active",
    trigger: triggerStep(status, state.trail, isWatched, hasEnded),
    outcome: outcomeStep(status, state.trail),
  };
}

function triggerStep(status: TrailStatus, trail: OrderTrail, isWatched: boolean, hasMirrorEnded: boolean): StepState {
  if (trail.triggers.length > 0) return "done";
  if (!isWatched) return hasMirrorEnded ? "off" : "pending";
  return status.isSettled ? "off" : "active";
}

function outcomeStep(status: TrailStatus, trail: OrderTrail): StepState {
  if (status.kind === "filled" || status.kind === "expired") return "done";
  if (status.kind === "triggered" || status.kind === "retrying") return "active";
  if (trail.outcomes.length > 0) return "done";
  return status.isSettled ? "off" : "pending";
}
