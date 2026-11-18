import { formatPrice, PRICE_DECIMALS } from "./tokens";
import styles from "./orders.module.css";

/** The ruler never shows less than this much either side of the current price, so a 1% trigger has room. */
const MIN_HALF_RANGE = 0.02;
/** Room beyond the trigger, so its line never sits on the edge of the track. */
const RANGE_PADDING = 1.5;

interface PriceRulerProps {
  /** Price on Base Pool A now, with PRICE_DECIMALS. */
  now: bigint | undefined;
  trigger: bigint | null;
  /** Stop-loss and limit buy fill at the trigger or below; take-profit at or above. */
  isBelow: boolean;
  firesNow: boolean;
}

function toNumber(price: bigint): number {
  return Number(price) / 10 ** PRICE_DECIMALS;
}

/**
 * Where the order fills, drawn: the track is the price, the solid line is now, the dashed line is the trigger,
 * and the filled part of the track is every price that fills the order. The sentence under it says the same in words.
 */
export function PriceRuler({ now, trigger, isBelow, firesNow }: PriceRulerProps) {
  if (now === undefined || !trigger) return null;

  const nowValue = toNumber(now);
  const triggerValue = toNumber(trigger);
  const distance = (triggerValue - nowValue) / nowValue;
  const halfRange = Math.max(MIN_HALF_RANGE, Math.abs(distance) * RANGE_PADDING);
  const low = nowValue * (1 - halfRange);
  const high = nowValue * (1 + halfRange);
  const position = (value: number) => Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100));
  const nowAt = position(nowValue);
  const triggerAt = position(triggerValue);
  const zone = isBelow ? { left: 0, width: triggerAt } : { left: triggerAt, width: 100 - triggerAt };
  const percent = `${Math.abs(distance * 100).toFixed(1)}% ${distance < 0 ? "below" : "above"} now`;

  return (
    <div className={styles.ruler}>
      <div className={styles.rulerTrack} aria-hidden="true">
        <span className={styles.rulerZone} style={{ left: `${zone.left}%`, width: `${zone.width}%` }} />
        <span className={styles.rulerNow} style={{ left: `${nowAt}%` }} />
        <span className={styles.rulerTrigger} style={{ left: `${triggerAt}%` }} />
      </div>
      <p className={styles.rulerCaption}>
        <span>
          Base Pool A now <span className="num">{formatPrice(now)}</span>
        </span>
        <span className={firesNow ? "warn" : undefined}>
          Fills at {formatPrice(trigger)} {isBelow ? "or below" : "or above"}, {percent}
        </span>
      </p>
    </div>
  );
}
