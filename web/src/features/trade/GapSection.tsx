import { GapChart } from "./GapChart";
import { HistoryNotice } from "./HistoryNotice";
import type { PoolHistoryView } from "./usePoolHistoryView";
import styles from "./history.module.css";

/** The gap chart, inside the live prices panel so it sits next to the swap form. */
export function GapSection({ view }: { view: PoolHistoryView }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <span className="small">Gap after each change</span>
        <span className={`${styles.legend} small faint`}>
          <span className={styles.legendItem}>
            <span className={`${styles.swatch} ${styles.swap}`} aria-hidden="true" />A swap
          </span>
          <span className={styles.legendItem}>
            <span className={`${styles.swatch} ${styles.contract}`} aria-hidden="true" />
            The contract’s trade
          </span>
          <span className={styles.legendItem}>
            <span className={`${styles.swatch} ${styles.reset}`} aria-hidden="true" />A reset
          </span>
        </span>
      </div>
      {view.status === "ready" && view.steps.length > 0 ? (
        <GapChart steps={view.steps} describeStep={view.describeStep} />
      ) : (
        <HistoryNotice view={view} emptyText={`Neither pool changed in ${view.windowText}. Your swap will be the first bar here.`} />
      )}
    </div>
  );
}
