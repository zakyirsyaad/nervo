import { TimelineStep } from "../trade/TimelineStep";
import { MIRROR_REASON_TEXT } from "./labels";
import type { OrderRef } from "./orderList";
import { EMPTY_TRAIL, trailStatus, type TrailKind } from "./trail";
import { mirrorText, outcomeText, placedText, triggerText, type TrackerInput } from "./trackerText";
import type { OrderTrailView } from "./useOrderTrail";
import tradeStyles from "../trade/trade.module.css";

const IDLE_STATUS = trailStatus({
  trail: EMPTY_TRAIL,
  orderStatus: undefined,
  isExpired: false,
  hasMirrorTimedOut: false,
  hasError: false,
});

const CANCEL_NOTE = "Cancel the order to get your tokens back.";
/** Kinds where the order still holds tokens but nothing more will happen to it. */
const NEEDS_CANCEL: readonly TrailKind[] = ["not-watched", "stopped", "expired-open"];

interface OrderTrackerProps {
  order: OrderRef | undefined;
  /** False when following an order from the book that this wallet did not place. */
  isOwn: boolean;
  /** Short address of the order's owner, shown when it is not the viewer. */
  ownerLabel: string | undefined;
  trail: OrderTrailView;
  canCancel: boolean;
  isCancelling: boolean;
  cancelError: string | undefined;
  onCancel: () => void;
}

export function OrderTracker({ order, isOwn, ownerLabel, trail, canCancel, isCancelling, cancelError, onCancel }: OrderTrackerProps) {
  const isReading = Boolean(order) && trail.isLoading;
  const status = order && !isReading ? trail.status : IDLE_STATUS;
  const input: TrackerInput = {
    ref: order ?? { id: 0n, txHash: "0x", blockNumber: 0n },
    trail: trail.snapshot?.trail ?? EMPTY_TRAIL,
    order: trail.snapshot?.order,
    isLasnaPartial: trail.snapshot?.isLasnaPartial ?? false,
    isUnichainPartial: trail.snapshot?.isUnichainPartial ?? false,
    status,
    isOwn,
  };
  const isLive = Boolean(order) && !isReading;
  const placed = placedText(input);
  const mirror = mirrorText(input);
  const trigger = triggerText(input);
  const outcome = outcomeText(input);

  return (
    <div className="panel">
      <div className="panel-head label">
        <span>
          Order tracker{order ? ` · #${order.id}` : ""}
          {order && !isOwn && ownerLabel ? ` · placed by ${ownerLabel}` : ""}
        </span>
        <span role="status" className={isLive ? status.tone : undefined}>
          {!order ? "Waiting for an order" : isReading ? "Reading the chains…" : status.label}
        </span>
      </div>

      <ol className={tradeStyles.timeline}>
        <TimelineStep index="1" state={order ? "done" : "pending"} {...(order ? placed : IDLE_TEXT.placed)} chain="unichain" />
        <TimelineStep index="2" state={isLive ? trail.steps.mirror : "pending"} {...(isLive ? mirror : IDLE_TEXT.mirror)} chain="lasna" />
        <TimelineStep index="3" state={isLive ? trail.steps.trigger : "pending"} {...(isLive ? trigger : IDLE_TEXT.trigger)} chain="base" />
        <TimelineStep index="4" state={isLive ? trail.steps.outcome : "pending"} {...(isLive ? outcome : IDLE_TEXT.outcome)} chain="unichain" />
      </ol>

      {isLive ? (
        <StalledRow
          kind={status.kind}
          stopReason={stopReason(trail)}
          canCancel={canCancel}
          isOwn={isOwn}
          isCancelling={isCancelling}
          onCancel={onCancel}
          onKeepWaiting={trail.keepWaiting}
          onRetry={trail.refresh}
        />
      ) : null}
      {cancelError ? (
        <p role="alert" className="panel-row small danger">
          {cancelError}
        </p>
      ) : null}
      <p className="panel-row small faint">
        Step 4 times the trip from the Base Sepolia block whose price fired the order to the Unichain Sepolia block
        that filled it. It is counted in whole seconds, because Unichain records block times in whole seconds.
      </p>
    </div>
  );
}

const IDLE_TEXT = {
  placed: { title: "You place an order on Unichain", detail: "Your tokens wait in the order book until the price is reached." },
  mirror: { title: "Reactive picks it up", detail: "A contract on the Reactive network copies your order so it can watch the price." },
  trigger: { title: "The price on Base reaches your trigger", detail: "It checks every price change on Base Pool A." },
  outcome: { title: "Your order trades on Unichain", detail: "Within seconds, with no bot or server in between." },
} as const;

function stopReason(trail: OrderTrailView): string | undefined {
  const mirrors = trail.snapshot?.trail.mirrors ?? [];
  const latest = mirrors[mirrors.length - 1];
  return latest ? MIRROR_REASON_TEXT[latest.reason] : undefined;
}

interface StalledRowProps {
  kind: TrailKind;
  stopReason: string | undefined;
  canCancel: boolean;
  isOwn: boolean;
  isCancelling: boolean;
  onCancel: () => void;
  onKeepWaiting: () => void;
  onRetry: () => void;
}

/** What to do when the order stopped without filling: wait, retry, or cancel to get the tokens back. */
function StalledRow({ kind, stopReason, canCancel, isOwn, isCancelling, onCancel, onKeepWaiting, onRetry }: StalledRowProps) {
  const your = isOwn ? "your" : "the";
  if (kind === "mirror-timeout") {
    return (
      <Stalled
        message={`Reactive has not picked up ${your} order after a minute. It may be out of the funds it needs to run. The tokens are safe in the order book, and ${isOwn ? "you" : "the owner"} can cancel at any time.`}
        action={{ label: "Keep waiting", onClick: onKeepWaiting }}
      />
    );
  }
  if (kind === "error") {
    return (
      <Stalled
        message={`We lost the connection while following ${your} order. The order is safe and keeps working without this page.`}
        action={{ label: "Try again", onClick: onRetry }}
      />
    );
  }
  if (!NEEDS_CANCEL.includes(kind)) return null;
  const message = kind === "stopped" && stopReason ? stopReason : CANCEL_NOTE;
  const notYours = isOwn ? `${message} Connect the wallet that placed it to cancel.` : "Only the wallet that placed this order can cancel it.";
  return (
    <Stalled
      message={canCancel ? message : notYours}
      action={canCancel ? { label: isCancelling ? "Cancelling…" : "Cancel and get tokens back", onClick: onCancel, isDisabled: isCancelling } : undefined}
    />
  );
}

interface StalledProps {
  message: string;
  action?: { label: string; onClick: () => void; isDisabled?: boolean };
}

function Stalled({ message, action }: StalledProps) {
  return (
    <div className={`panel-row ${tradeStyles.stalled}`}>
      <p role="alert" className="small warn">
        {message}
      </p>
      {action ? (
        <button type="button" className="btn" onClick={action.onClick} disabled={action.isDisabled}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
