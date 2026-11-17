import { EXPIRY_CHOICES, KIND_SPEC, ORDER_KINDS, type ExpiryChoice, type OrderKind } from "./kinds";
import tradeStyles from "../trade/trade.module.css";
import styles from "./orders.module.css";

interface KindPickerProps {
  value: OrderKind;
  onChange: (kind: OrderKind) => void;
}

export function KindPicker({ value, onChange }: KindPickerProps) {
  return (
    <div role="group" aria-label="Order type" className={tradeStyles.toggle}>
      {ORDER_KINDS.map((kind) => (
        <button key={kind} type="button" aria-pressed={value === kind} onClick={() => onChange(kind)}>
          {KIND_SPEC[kind].name}
        </button>
      ))}
    </div>
  );
}

interface ExpiryPickerProps {
  value: ExpiryChoice["id"];
  onChange: (id: ExpiryChoice["id"]) => void;
}

export function ExpiryPicker({ value, onChange }: ExpiryPickerProps) {
  return (
    <div className={tradeStyles.field}>
      <span id="order-expiry-label" className="small muted">
        Expires after
      </span>
      <div role="group" aria-labelledby="order-expiry-label" className={`${tradeStyles.toggle} ${styles.stretch}`}>
        {EXPIRY_CHOICES.map((choice) => (
          <button key={choice.id} type="button" aria-pressed={value === choice.id} onClick={() => onChange(choice.id)}>
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}
