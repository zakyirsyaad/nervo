import type { ReactNode } from "react";
import type { Address } from "viem";
import type { Outcome } from "@/config/abis";
import { HashLink } from "@/components/HashLink";
import { USDC_DECIMALS, WETH_DECIMALS } from "@/config/contracts";
import { formatAgo, formatAmount, formatCompact, formatPercent, shortHex } from "@/lib/format";
import { sameAddress, type Answer, type Change, type LoopRow, type SwapLeg } from "./history";
import styles from "./history.module.css";

interface LoopListProps {
  rows: readonly LoopRow[];
  account: Address | undefined;
  /** Clock of the last read, in seconds, so every "ago" is measured from the same moment. */
  nowSeconds: number;
}

function weth(amount: bigint): string {
  return `${formatCompact(amount, WETH_DECIMALS, 4)} WETH`;
}

function usdc(amount: bigint): string {
  return `${formatCompact(amount, USDC_DECIMALS, 2)} USDC`;
}

function legText(leg: SwapLeg): string {
  return leg.wethIn ? `${weth(leg.amountIn)} for ${usdc(leg.amountOut)}` : `${usdc(leg.amountIn)} for ${weth(leg.amountOut)}`;
}

/** Why the executor stopped, in words, for the outcomes a visitor is likely to see. */
const SKIP_TEXT: Partial<Record<Outcome, string>> = {
  SkippedMarginGone: "It checked the prices again on arrival and the gap was already gone.",
  SkippedExpired: "It arrived after its 60-second deadline.",
  SkippedAlreadyExecuted: "It had already traded for this change.",
  SkippedInsufficientInventory: "It did not hold enough USDC to trade.",
};

/** Answer time to one decimal, e.g. "1.6 s". */
function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

export function LoopList({ rows, account, nowSeconds }: LoopListProps) {
  return (
    <div className={styles.loops}>
      <div className={`${styles.loopRow} ${styles.loopHead} small faint`} aria-hidden="true">
        <span>When</span>
        <span>What changed</span>
        <span>Gap it left</span>
        <span>What the contract did</span>
        <span>Proof</span>
      </div>
      <ol className={styles.loopList}>
        {rows.map((row) => (
          <li key={row.key} className={styles.loopRow}>
            <Cell label="When">
              <span className="small faint">{whenText(row, nowSeconds)}</span>
            </Cell>
            <Cell label="What changed">
              {row.change ? <ChangeText change={row.change} account={account} /> : <NoChangeText />}
            </Cell>
            <Cell label="Gap it left">
              <span className={`${styles.gapValue} num`}>{row.gapAfterChange === null ? "not known" : formatPercent(row.gapAfterChange)}</span>
              <span className="small faint">Pool B against A</span>
            </Cell>
            <Cell label="What the contract did">
              <AnswerText row={row} />
            </Cell>
            <Cell label="Proof">
              <span className={styles.proof}>
                {row.change ? (
                  <span className="small">
                    <span className="faint">Change </span>
                    <HashLink chain="base" hash={row.change.txHash} />
                  </span>
                ) : null}
                {row.answer ? (
                  <span className="small">
                    <span className="faint">Trade </span>
                    <HashLink chain="base" hash={row.answer.txHash} />
                  </span>
                ) : null}
              </span>
            </Cell>
          </li>
        ))}
      </ol>
    </div>
  );
}

function whenText(row: LoopRow, nowSeconds: number): string {
  const timestamp = row.change?.timestamp;
  return timestamp === undefined ? "earlier" : formatAgo(timestamp, nowSeconds);
}

/** One cell. Its label is the column heading on wide screens and a visible caption on phones. */
function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.cell}>
      <span className={`${styles.cellLabel} small faint`}>{label}</span>
      {children}
    </div>
  );
}

function ChangeText({ change, account }: { change: Change; account: Address | undefined }) {
  if (change.kind === "reset") {
    const pools = Object.keys(change.resetPrices);
    const prices = Object.values(change.resetPrices);
    return (
      <>
        <span className={styles.rowTitle}>{pools.length > 1 ? "Both pools reset by their owner" : `Pool ${pools[0]} reset by its owner`}</span>
        <span className="small muted num">Price set to {formatAmount(prices[0] ?? 0n, USDC_DECIMALS, 2)} USDC</span>
      </>
    );
  }
  const who = sameAddress(change.actor, account) ? "You" : null;
  const pools = [...new Set(change.swaps.map((leg) => leg.pool))].join(" and ");
  return (
    <>
      <span className={styles.rowTitle}>
        {who ?? <span className="mono">{shortHex(change.actor)}</span>} swapped on Pool {pools}
      </span>
      {change.swaps.map((leg, index) => (
        <span key={index} className="small muted num">
          Paid {legText(leg)}
        </span>
      ))}
    </>
  );
}

function NoChangeText() {
  return (
    <>
      <span className={styles.rowTitle}>A change before this window</span>
      <span className="small muted">The swap it answered is older than the history shown here.</span>
    </>
  );
}

function AnswerText({ row }: { row: LoopRow }) {
  const { answer, verdict } = row;
  if (answer) return <TradeText answer={answer} gapAfter={row.gapAfterAnswer} />;
  if (verdict === "skipped" && row.skipped) {
    return (
      <>
        <span className={`${styles.rowTitle} muted`}>The contract came back and did not trade</span>
        <span className="small muted">{SKIP_TEXT[row.skipped] ?? "It checked again on arrival and stopped."}</span>
        <span className="mono faint">{row.skipped}</span>
      </>
    );
  }
  if (verdict === "too-small") {
    return (
      <>
        <span className={`${styles.rowTitle} muted`}>No trade needed</span>
        <span className="small muted">The gap could not cover the fees and the 2 USDC minimum.</span>
      </>
    );
  }
  if (verdict === "waiting") {
    return (
      <>
        <span className={`${styles.rowTitle} warn`}>Waiting for the contract</span>
        <span className="small muted">A trade usually lands within two seconds.</span>
      </>
    );
  }
  return (
    <>
      <span className={`${styles.rowTitle} muted`}>No trade followed</span>
      <span className="small muted">No trade within 60 seconds.</span>
    </>
  );
}

function TradeText({ answer, gapAfter }: { answer: Answer; gapAfter: number | null }) {
  const kept = answer.profit >= 0n ? `+${usdc(answer.profit)}` : `-${usdc(-answer.profit)}`;
  return (
    <>
      {answer.afterMs !== undefined ? (
        <span className={styles.answerTime}>
          <span className="num">{seconds(answer.afterMs)}</span>
          <span className={styles.answerUnit}>to trade back</span>
        </span>
      ) : (
        <span className={styles.rowTitle}>Traded</span>
      )}
      <span className="small muted">
        Bought on Pool {answer.buyPool}, sold on Pool {answer.sellPool}. <span className="ok num">{kept}</span> kept.
      </span>
      {gapAfter !== null ? <span className="small faint num">Gap now {formatPercent(gapAfter)}</span> : null}
    </>
  );
}
