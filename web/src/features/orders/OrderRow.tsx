import { KIND_SPEC } from "./kinds";
import { orderSentence, orderStatusBadge } from "./labels";
import type { OrderView } from "./orderList";
import { formatPrice, formatToken, ORDER_TOKENS } from "./tokens";
import styles from "./orders.module.css";

const EXPIRY_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

interface OrderRowProps {
  view: OrderView;
  isSelected: boolean;
  canCancel: boolean;
  isCancelling: boolean;
  /** Another cancel is running. */
  isCancelBlocked: boolean;
  error: string | undefined;
  onSelect: () => void;
  onCancel: () => void;
}

export function OrderRow({ view, isSelected, canCancel, isCancelling, isCancelBlocked, error, onSelect, onCancel }: OrderRowProps) {
  const badge = orderStatusBadge(view.status, view.isExpired);
  const amount = view.tokenIn ? formatToken(view.amountIn, ORDER_TOKENS[view.tokenIn]) : `${view.amountIn} units`;
  const expires = EXPIRY_FORMAT.format(new Date(Number(view.expiry) * 1000));

  return (
    <li className={`${styles.orderRow} ${isSelected ? styles.selected : ""}`}>
      <button type="button" className={styles.orderSelect} aria-pressed={isSelected} onClick={onSelect}>
        <span className={styles.orderTitle}>
          {view.kind ? KIND_SPEC[view.kind].name : "Order"} <span className="mono faint">#{view.ref.id.toString()}</span>
        </span>
        <span className="small muted">{orderSentence(view.kind, amount, formatPrice(view.triggerPrice))}</span>
        <span className="small faint">
          {view.status === "Open" ? `${view.isExpired ? "Expired" : "Expires"} ${expires}` : `Placed in block ${view.ref.blockNumber}`}
        </span>
      </button>
      <div className={styles.orderAside}>
        <span className={`label ${badge.tone}`}>{badge.label}</span>
        {canCancel ? (
          <button type="button" className="btn" disabled={isCancelBlocked} onClick={onCancel}>
            {isCancelling ? "Cancelling…" : view.isExpired ? "Get tokens back" : "Cancel"}
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className={`small danger ${styles.rowError}`}>
          {error}
        </p>
      ) : null}
    </li>
  );
}
