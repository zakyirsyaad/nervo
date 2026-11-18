import { COMPARE_STEPS, ETH_SAVED_PERCENT, FILTERED, UNFILTERED, type StackResult } from "@/data/evidence";
import styles from "./CompareBars.module.css";

const ETH_DIGITS = 7;

interface BarProps {
  label: string;
  stack: StackResult;
  /** Bars share one scale: the stack that sent the most trades fills the track. */
  scale: number;
}

function Bar({ label, stack, scale }: BarProps) {
  const tradedWidth = `${(stack.executed / scale) * 100}%`;
  const wastedWidth = `${(stack.wasted / scale) * 100}%`;

  return (
    <div className={styles.row}>
      <div className={styles.rowHead}>
        <span className={styles.rowLabel}>{label}</span>
        <span className="num muted">
          {stack.callbacks} sent, {stack.executed} traded, {stack.wasted} wasted
        </span>
      </div>
      <div className={styles.track} aria-hidden="true">
        <span className={styles.traded} style={{ width: tradedWidth }} />
        {stack.wasted > 0 ? <span className={styles.wasted} style={{ width: wastedWidth }} /> : null}
      </div>
    </div>
  );
}

/** The filter comparison as two bars on one scale, with the fees underneath. Every value comes from compare.json. */
export function CompareBars() {
  const scale = Math.max(FILTERED.callbacks, UNFILTERED.callbacks);

  return (
    <figure className={`panel ${styles.figure}`}>
      <figcaption className={styles.caption}>
        <span>Trades sent to Base Sepolia for the same {COMPARE_STEPS} price changes</span>
        <span className={styles.legend}>
          <span className={styles.key}>
            <span className={styles.swatchTraded} aria-hidden="true" />
            Traded
          </span>
          <span className={styles.key}>
            <span className={styles.swatchWasted} aria-hidden="true" />
            Cancelled on arrival
          </span>
        </span>
      </figcaption>
      <Bar label="With the first check" stack={FILTERED} scale={scale} />
      <Bar label="Without it" stack={UNFILTERED} scale={scale} />
      <dl className={styles.fees}>
        <div>
          <dt>Base Sepolia fees, with the check</dt>
          <dd className="mono num">{FILTERED.ethSpent.toFixed(ETH_DIGITS)} ETH</dd>
        </div>
        <div>
          <dt>Base Sepolia fees, without it</dt>
          <dd className="mono num">{UNFILTERED.ethSpent.toFixed(ETH_DIGITS)} ETH</dd>
        </div>
        <div>
          <dt>Saved by checking first</dt>
          <dd className="num ok">{ETH_SAVED_PERCENT}%</dd>
        </div>
      </dl>
    </figure>
  );
}
