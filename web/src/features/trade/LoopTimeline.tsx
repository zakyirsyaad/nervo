import { USDC_DECIMALS } from "@/config/contracts";
import { LATENCIES_MS } from "@/data/evidence";
import { formatAmount, formatSeconds } from "@/lib/format";
import { percentile } from "@/lib/latency";
import type { LoopStatusKind } from "./loop";
import { TimelineStep as Step } from "./TimelineStep";
import type { DecisionRecord, OutcomeRecord } from "./tracker";
import type { LoopView } from "./useLoop";
import styles from "./trade.module.css";

const TYPICAL_LATENCY_MS = percentile(LATENCIES_MS, 50);

const STATUS_TONE: Record<LoopStatusKind, string> = {
  "waiting-decision": "warn",
  "waiting-callback": "warn",
  executed: "ok",
  skipped: "warn",
  rejected: "muted",
  "decision-timeout": "danger",
  "callback-timeout": "danger",
  error: "danger",
};

/** Shown when the loop stopped without a result, with a way to look again. */
const STALLED: Partial<Record<LoopStatusKind, { message: string; action: string }>> = {
  "decision-timeout": {
    message:
      "The contract on Reactive has not responded for a minute. It has probably run out of the funds it needs to run. Your swap went through and is safe.",
    action: "Keep waiting",
  },
  "callback-timeout": {
    message:
      "The contract decided to trade, but the trade has not arrived on Base Sepolia after a minute. It may just be late.",
    action: "Keep waiting",
  },
  error: {
    message: "We lost the connection while following your swap. Your swap is safe; you can still open it with the link above.",
    action: "Try again",
  },
};

interface LoopTimelineProps {
  loop: LoopView;
  hasSwap: boolean;
}

export function LoopTimeline({ loop, hasSwap }: LoopTimelineProps) {
  const { trigger, decision, outcome, status } = loop;
  const isWaitingCallback = status.kind === "waiting-callback";
  const stalled = hasSwap ? STALLED[status.kind] : undefined;

  return (
    <div className="panel">
      <div className="panel-head label">
        <span>What happens next</span>
        <span role="status" className={hasSwap ? STATUS_TONE[status.kind] : undefined}>
          {hasSwap ? status.label : "Waiting for your swap"}
        </span>
      </div>

      <ol className={styles.timeline}>
        <Step
          index="1"
          chain="base"
          state={trigger ? "done" : !hasSwap ? "pending" : status.isFinal ? "off" : "active"}
          title={trigger ? "Your swap went through" : "You swap"}
          detail="The price on the pool you picked moves away from the other pool."
          tech={trigger ? `Base Sepolia · block ${trigger.blockNumber}` : undefined}
          link={trigger ? { chain: "base", hash: trigger.txHash } : undefined}
        />
        <Step
          index="2"
          chain="lasna"
          state={decision ? "done" : !trigger ? "pending" : status.isFinal ? "off" : "active"}
          title={decisionTitle(decision)}
          detail={decisionDetail(decision)}
          tech={decision ? `${decision.decision} · Reactive Lasna · block ${decision.blockNumber}` : undefined}
          link={decision ? { chain: "lasna", hash: decision.txHash } : undefined}
        />
        <Step
          index="3"
          chain="base"
          state={outcome ? "done" : !decision ? "pending" : isWaitingCallback ? "active" : "off"}
          title={outcome ? `The trade arrived in ${formatSeconds(outcome.latencyMs)}` : "The trade is sent back to Base"}
          detail={deliveryDetail(decision, outcome, isWaitingCallback)}
          tech={outcome ? `Base Sepolia · block ${outcome.blockNumber}` : undefined}
          link={outcome ? { chain: "base", hash: outcome.txHash } : undefined}
        />
        <Step
          index="4"
          chain="base"
          state={outcome ? "done" : hasSwap && status.isFinal ? "off" : "pending"}
          title={outcomeTitle(outcome)}
          detail={outcomeDetail(outcome, status.kind)}
          tech={outcome ? outcome.outcome : undefined}
        />
      </ol>

      {stalled ? (
        <div className={`panel-row ${styles.stalled}`}>
          <p role="alert" className="small danger">
            {stalled.message}
          </p>
          <button type="button" className="btn" onClick={loop.retry}>
            {stalled.action}
          </button>
        </div>
      ) : null}
      <p className="panel-row small faint">
        The time in step 3 runs from the moment your swap was recorded to the moment the trade was recorded, both on
        Base Sepolia.
      </p>
    </div>
  );
}

function decisionTitle(decision: DecisionRecord | undefined): string {
  if (!decision) return "A contract on Reactive checks the difference";
  if (decision.decision === "CallbackRequested") return "Worth trading";
  if (decision.decision === "MarginBelowThreshold") return "Not worth trading";
  return "No trade needed";
}

function decisionDetail(decision: DecisionRecord | undefined): string {
  if (!decision) return "It works out whether buying on the cheaper pool and selling on the other would make a profit.";
  const quoted = formatAmount(decision.quotedOut, USDC_DECIMALS, 2);
  if (decision.decision === "CallbackRequested") {
    return `Buying with 1,000 USDC on the cheaper pool and selling on the other would return about ${quoted} USDC.`;
  }
  if (decision.decision === "MarginBelowThreshold") {
    return `1,000 USDC would come back as only ${quoted} USDC, which does not cover the fees. Nothing more happens.`;
  }
  return "The contract saw the swap and decided there was nothing to do.";
}

function deliveryDetail(
  decision: DecisionRecord | undefined,
  outcome: OutcomeRecord | undefined,
  isWaiting: boolean,
): string {
  if (outcome) return "That is the time from your swap to the trade, across two chains.";
  if (decision && decision.decision !== "CallbackRequested") return "Skipped, so it cost nothing.";
  if (isWaiting && TYPICAL_LATENCY_MS) return `On its way. This usually takes about ${formatSeconds(TYPICAL_LATENCY_MS)}.`;
  return "If it is worth it, the contract sends the trade to Base Sepolia by itself.";
}

function outcomeTitle(outcome: OutcomeRecord | undefined): string {
  if (!outcome) return "Result";
  if (outcome.outcome === "Executed") return "Trade done";
  if (outcome.outcome === "SkippedMarginGone") return "Too late, so no trade";
  return "No trade";
}

function outcomeDetail(outcome: OutcomeRecord | undefined, kind: LoopStatusKind): string {
  if (!outcome) {
    return kind === "rejected" ? "No trade this time." : "You see whether the trade was made and how much profit it kept.";
  }
  if (outcome.outcome === "Executed" && outcome.actualOut > outcome.amountIn) {
    const profit = formatAmount(outcome.actualOut - outcome.amountIn, USDC_DECIMALS, 2);
    return `Bought low on one pool, sold high on the other. Profit kept: ${profit} USDC.`;
  }
  if (outcome.outcome === "SkippedMarginGone") {
    return "The prices moved back before the trade arrived, so it was safely cancelled. No money was lost.";
  }
  return "The trade was safely cancelled. No money was lost.";
}
