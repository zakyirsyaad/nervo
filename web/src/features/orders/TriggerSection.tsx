import { HistoryNotice } from "../trade/HistoryNotice";
import type { PriceStep } from "../trade/history";
import type { PoolHistoryView } from "../trade/usePoolHistoryView";
import { TriggerChart, type ChartTrigger } from "./TriggerChart";
import chart from "../trade/history.module.css";
import styles from "./orders.module.css";

interface TriggerSectionProps {
  view: PoolHistoryView;
  /** Changes to Pool A only, oldest first. */
  steps: readonly PriceStep[];
  fired: ReadonlyMap<string, readonly bigint[]>;
  trigger: ChartTrigger | undefined;
}

/** The price every order watches, with the followed order's trigger, inside the live prices panel. */
export function TriggerSection({ view, steps, fired, trigger }: TriggerSectionProps) {
  return (
    <div className={chart.section}>
      <div className={chart.sectionHead}>
        <span className="small">Price on Base after each change</span>
        <span className={`${chart.legend} small faint`}>
          <span className={chart.legendItem}>
            <span className={styles.keyPrice} aria-hidden="true" />
            Base Pool A
          </span>
          <span className={chart.legendItem}>
            <span className={styles.keyTrigger} aria-hidden="true" />
            Trigger
          </span>
          <span className={chart.legendItem}>
            <span className={styles.keyFired} aria-hidden="true" />
            An order fired
          </span>
        </span>
      </div>
      {view.status === "ready" && steps.length > 0 ? (
        <TriggerChart steps={steps} fired={fired} trigger={trigger} describeStep={view.describeStep} />
      ) : (
        <HistoryNotice view={view} emptyText={`The price on Base has not moved in ${view.windowText}.`} />
      )}
    </div>
  );
}
