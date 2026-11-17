"use client";

import { useState } from "react";
import type { Address } from "viem";
import { HistoryNotice } from "./HistoryNotice";
import { LoopList } from "./LoopList";
import type { PoolHistoryView } from "./usePoolHistoryView";
import styles from "./history.module.css";

const ROWS_PER_PAGE = 6;

interface PoolHistoryProps {
  view: PoolHistoryView;
  account: Address | undefined;
}

/** Every recent change to the pools, next to what the contract did about it. Full width, under the workspace. */
export function PoolHistory({ view, account }: PoolHistoryProps) {
  const [shownRows, setShownRows] = useState(ROWS_PER_PAGE);
  const { summary, rows } = view;

  return (
    <section className={styles.history} aria-labelledby="pool-history-title">
      <header className={styles.head}>
        <div className={styles.headText}>
          <h2 id="pool-history-title" className="h3">
            What happened on the pools
          </h2>
          <p className="small muted">
            Every change in {view.windowText} on Base Sepolia, next to what the contract did about it.
          </p>
        </div>
        {summary.answered > 0 ? (
          <dl className={styles.summary}>
            <div>
              <dt className="small faint">Changes answered</dt>
              <dd className="num">{summary.answered}</dd>
            </div>
            {summary.typicalMs !== undefined ? (
              <div>
                <dt className="small faint">Typical answer</dt>
                <dd className="num accent">{(summary.typicalMs / 1000).toFixed(1)} s</dd>
              </div>
            ) : null}
            {summary.fastestMs !== undefined ? (
              <div>
                <dt className="small faint">Fastest</dt>
                <dd className="num">{(summary.fastestMs / 1000).toFixed(1)} s</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </header>

      <div className="panel">
        {view.isRefreshFailing ? (
          <p role="status" className="panel-row small warn">
            The last update failed; retrying.
          </p>
        ) : null}
        {view.status === "ready" && rows.length > 0 ? (
          <>
            <LoopList rows={rows.slice(0, shownRows)} account={account} nowSeconds={view.nowSeconds} />
            {rows.length > shownRows ? (
              <div className={styles.more}>
                <button type="button" className="btn" onClick={() => setShownRows((count) => count + ROWS_PER_PAGE)}>
                  Show {Math.min(ROWS_PER_PAGE, rows.length - shownRows)} older changes
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <HistoryNotice
            view={view}
            emptyText={`Nothing changed on either pool in ${view.windowText}. Make a swap: it shows up here within a few seconds, next to the contract’s answer.`}
          />
        )}
      </div>
    </section>
  );
}
