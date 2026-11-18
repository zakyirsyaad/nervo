import { EXPIRY_CHOICES, KIND_SPEC, ORDER_KINDS, type ExpiryChoice, type OrderKind } from "./kinds";
import tradeStyles from "../trade/trade.module.css";
import styles from "./orders.module.css";

interface KindPickerProps {
  value: OrderKind;
  onChange: (kind: OrderKind) => void;
}

/** Order types as radio cards, each with the sentence that says what it does, so nobody picks by name alone. */
export function KindPicker({ value, onChange }: KindPickerProps) {
  return (
    <fieldset className={styles.kinds}>
      <legend className="small muted">What should happen</legend>
      {ORDER_KINDS.map((kind) => (
        <label key={kind} className={styles.kind}>
          <input
            type="radio"
            name="order-kind"
            value={kind}
            checked={value === kind}
            onChange={() => onChange(kind)}
          />
          <span className={styles.kindName}>{KIND_SPEC[kind].name}</span>
          <span className={styles.kindSummary}>{KIND_SPEC[kind].summary}</span>
        </label>
      ))}
    </fieldset>
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
