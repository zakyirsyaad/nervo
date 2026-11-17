import type { PoolHistoryView } from "./usePoolHistoryView";
import styles from "./history.module.css";

interface HistoryNoticeProps {
  view: PoolHistoryView;
  /** What to say when the window holds no changes. */
  emptyText: string;
}

/** Loading, error and empty states for anything drawn from the pools' history. */
export function HistoryNotice({ view, emptyText }: HistoryNoticeProps) {
  if (view.status === "error") {
    return (
      <div className={`${styles.notice} ${styles.loadError}`}>
        <p className="small muted">Could not read past swaps from Base Sepolia. The live prices still work.</p>
        <button type="button" className="btn" onClick={view.retry}>
          Try again
        </button>
      </div>
    );
  }
  // Loaded but nothing to draw (no changes, or none to this pool) reads as empty, never as loading.
  const text = view.status === "loading" ? `Reading the pools’ changes over ${view.windowText}…` : emptyText;
  return <p className={`${styles.notice} small muted`}>{text}</p>;
}
