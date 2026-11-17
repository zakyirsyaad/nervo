"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { ChainMark } from "@/components/ChainMark";
import { ADDRESSES, USDC_DECIMALS } from "@/config/contracts";
import { gapBps, spotPriceUsdc } from "@/lib/amm";
import { formatAmount, formatPercent, shortHex } from "@/lib/format";
import { ActivityList } from "./ActivityList";
import { buildActivity, buildPriceSteps, groupByTransaction, sameAddress, type PriceStep } from "./history";
import { PriceChart } from "./PriceChart";
import type { PoolPair } from "./quote";
import { HISTORY_HOURS, usePoolHistory } from "./useHistory";
import styles from "./history.module.css";

const MAX_STEPS = 24;
const MAX_ENTRIES = 8;

interface PoolHistoryProps {
  pools: PoolPair | undefined;
  account: Address | undefined;
}

/** What changed the pools recently, and what both prices did after each change. */
export function PoolHistory({ pools, account }: PoolHistoryProps) {
  const { data, isError, isPending, refetch } = usePoolHistory();
  const txs = useMemo(() => (data ? groupByTransaction(data.logs) : []), [data]);
  const steps = useMemo(() => buildPriceSteps(txs, pools, MAX_STEPS, ADDRESSES.arbExecutor), [txs, pools]);
  const entries = useMemo(() => buildActivity(txs, ADDRESSES.arbExecutor, MAX_ENTRIES), [txs]);

  function describeStep(step: PriceStep): string {
    if (step.txHash === null) return "Before the first change shown";
    if (step.byContract) return "The contract's trade";
    if (!step.hasSwap) return "Reset by the pool owner";
    if (sameAddress(step.actor ?? undefined, account)) return "Your swap";
    return `Swap by ${shortHex(step.actor ?? "")}`;
  }

  const hasNoChanges = data !== undefined && txs.length === 0;
  const isRefreshFailing = isError && data !== undefined;
  const windowText = `the last ${HISTORY_HOURS} hours`;

  return (
    <div className={styles.history}>
      <section className={`panel ${styles.chartPanel}`} aria-labelledby="price-history-title">
        <div className="panel-head label">
          <span id="price-history-title">Price after each change · 1 WETH in USDC</span>
          <ChartLegend />
        </div>
        <div className={styles.panelBody}>
          {isPending ? <p className={`${styles.placeholder} small muted`}>Reading the pools’ changes over {windowText}…</p> : null}
          {isError && !data ? <LoadError onRetry={() => void refetch()} /> : null}
          {hasNoChanges ? <NoChanges pools={pools} windowText={windowText} /> : null}
          {steps.length > 0 ? <PriceChart steps={steps} describeStep={describeStep} /> : null}
        </div>
        {steps.length > 0 ? <StepTable steps={steps} describeStep={describeStep} /> : null}
      </section>

      <section className={`panel ${styles.activityPanel}`} aria-labelledby="activity-title">
        <div className="panel-head label">
          <span id="activity-title" className="chain-tag">
            <ChainMark chain="base" />
            Recent activity on both pools
          </span>
          {isRefreshFailing ? (
            <span role="status" className="warn">
              Update failed, retrying
            </span>
          ) : null}
        </div>
        {isPending ? <p className={`${styles.placeholder} small muted`}>Reading recent swaps…</p> : null}
        {isError && !data ? <LoadError onRetry={() => void refetch()} /> : null}
        {hasNoChanges ? (
          <p className={`${styles.placeholder} small muted`}>
            No swaps in {windowText}. Make one with the form above and it shows up here within a few seconds.
          </p>
        ) : null}
        {data && entries.length > 0 ? <ActivityList entries={entries} account={account} nowSeconds={data.readAtSeconds} /> : null}
      </section>
    </div>
  );
}

function ChartLegend() {
  return (
    <span className={styles.legend}>
      <span className={styles.legendItem}>
        <span className={`${styles.key} ${styles.keyA}`} aria-hidden="true" />
        Pool A
      </span>
      <span className={styles.legendItem}>
        <span className={`${styles.key} ${styles.keyB}`} aria-hidden="true" />
        Pool B
      </span>
      <span className={styles.legendItem}>
        <span className={styles.keyMark} aria-hidden="true" />
        The contract’s trade
      </span>
    </span>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={`${styles.placeholder} ${styles.loadError}`}>
      <p className="small muted">Could not read past swaps from Base Sepolia. The live prices above still work.</p>
      <button type="button" className="btn" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

function NoChanges({ pools, windowText }: { pools: PoolPair | undefined; windowText: string }) {
  const prices = pools
    ? `Pool A is at ${formatAmount(spotPriceUsdc(pools.A), USDC_DECIMALS, 2)} and Pool B at ${formatAmount(spotPriceUsdc(pools.B), USDC_DECIMALS, 2)}.`
    : "";
  return (
    <p className={`${styles.placeholder} small muted`}>
      Neither price has moved in {windowText}. {prices}
    </p>
  );
}

function StepTable({ steps, describeStep }: { steps: readonly PriceStep[]; describeStep: (step: PriceStep) => string }) {
  return (
    <details className={styles.tableDetails}>
      <summary>Show these prices as a table</summary>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Change</th>
              <th scope="col" className="numeric">
                Pool A
              </th>
              <th scope="col" className="numeric">
                Pool B
              </th>
              <th scope="col" className="numeric">
                B against A
              </th>
            </tr>
          </thead>
          <tbody>
            {[...steps].reverse().map((step) => (
              <tr key={step.key}>
                <td>{describeStep(step)}</td>
                <td className="numeric num">{step.priceA === null ? "not known" : formatAmount(step.priceA, USDC_DECIMALS, 2)}</td>
                <td className="numeric num">{step.priceB === null ? "not known" : formatAmount(step.priceB, USDC_DECIMALS, 2)}</td>
                <td className="numeric num">
                  {step.priceA !== null && step.priceB !== null ? formatPercent(gapBps(step.priceB, step.priceA)) : "not known"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
