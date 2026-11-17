import type { ReactNode } from "react";
import tradeStyles from "../trade/trade.module.css";

interface OrderFieldProps {
  id: string;
  label: string;
  /** Right-aligned context next to the label, such as a balance. */
  aside?: string;
  value: string;
  onChange: (value: string) => void;
  symbol: string;
  isInvalid: boolean;
  hint?: ReactNode;
  isWarning?: boolean;
}

/** A labelled amount input with its unit and a hint line, styled like the swap form. */
export function OrderField({ id, label, aside, value, onChange, symbol, isInvalid, hint, isWarning = false }: OrderFieldProps) {
  const hintId = `${id}-hint`;
  return (
    <div className={tradeStyles.field}>
      <div className={`small muted ${tradeStyles.fieldHead}`}>
        <label htmlFor={id}>{label}</label>
        {aside ? <span className="num">{aside}</span> : null}
      </div>
      <div className={`${tradeStyles.inputBox} ${tradeStyles.editable}`}>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={isInvalid}
          aria-describedby={hint ? hintId : undefined}
        />
        <span className={tradeStyles.symbol}>{symbol}</span>
      </div>
      {hint ? (
        <p id={hintId} className={`small ${isWarning ? "warn" : "faint"}`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
