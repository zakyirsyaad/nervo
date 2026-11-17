"use client";

import { useState, type ReactNode } from "react";
import type { Address } from "viem";
import { HashLink } from "@/components/HashLink";
import { shortHex } from "@/lib/format";
import { sameAddress } from "../trade/history";
import { KIND_SPEC, outputToken } from "./kinds";
import { OUTCOME_TEXT, orderStatusBadge } from "./labels";
import type { BookRow } from "./orderBook";
import type { OrderBook } from "./useOrderBook";
import { formatPrice, formatToken, ORDER_TOKENS } from "./tokens";
import chart from "../trade/history.module.css";
import styles from "./orders.module.css";

const ROWS_PER_PAGE = 6;

interface OrderBookSectionProps {
  book: OrderBook;
  account: Address | undefined;
  /** The order the tracker above follows. */
  followedId: bigint | undefined;
  onFollow: (id: bigint) => void;
}

/** Every order on the book, by anyone: what fired it on Base and how long the fill took on Unichain. */
export function OrderBookSection({ book, account, followedId, onFollow }: OrderBookSectionProps) {
  const [shownRows, setShownRows] = useState(ROWS_PER_PAGE);
  const { summary, rows } = book;

  return (
    <section className={chart.history} aria-labelledby="order-book-title">
      <header className={chart.head}>
        <div className={chart.headText}>
          <h2 id="order-book-title" className="h3">
            Orders on the book
          </h2>
          <p className="small muted">
            Every order placed in about the last 14 hours, by anyone: what fired it on Base and how long the fill took on
            Unichain. Fill times are whole seconds, because Unichain stamps its blocks to the second.
          </p>
        </div>
        {summary.fired > 0 ? (
          <dl className={chart.summary}>
            <div>
              <dt className="small faint">Filled</dt>
              <dd className="num">
                {summary.filled} of {summary.fired}
              </dd>
            </div>
            {summary.typicalSeconds !== undefined ? (
              <div>
                <dt className="small faint">Typical fill</dt>
                <dd className="num accent">{summary.typicalSeconds} s</dd>
              </div>
            ) : null}
            {summary.fastestSeconds !== undefined ? (
              <div>
                <dt className="small faint">Fastest</dt>
                <dd className="num">{summary.fastestSeconds} s</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </header>

      <div className="panel">
        {book.isError && rows.length > 0 ? (
          <p role="status" className="panel-row small warn">
            The last update failed; retrying.
          </p>
        ) : null}
        {rows.length > 0 ? (
          <div className={styles.book}>
            <div className={`${styles.bookRow} ${styles.bookHead} small faint`} aria-hidden="true">
              <span>Order</span>
              <span>What it was</span>
              <span>Base price that fired it</span>
              <span>Unichain paid</span>
              <span>Time to fill</span>
              <span>Proof</span>
            </div>
            <ol className={styles.list}>
              {rows.slice(0, shownRows).map((row) => (
                <BookLine
                  key={row.view.ref.id.toString()}
                  row={row}
                  isYours={sameAddress(row.view.owner, account)}
                  isFollowed={row.view.ref.id === followedId}
                  onFollow={() => onFollow(row.view.ref.id)}
                />
              ))}
            </ol>
            {rows.length > shownRows ? (
              <div className={chart.more}>
                <button type="button" className="btn" onClick={() => setShownRows((count) => count + ROWS_PER_PAGE)}>
                  Show {Math.min(ROWS_PER_PAGE, rows.length - shownRows)} older orders
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <BookNotice book={book} />
        )}
      </div>
    </section>
  );
}

function BookNotice({ book }: { book: OrderBook }) {
  if (book.isError) {
    return (
      <div className={`${chart.notice} ${chart.loadError}`}>
        <p className="small muted">Could not read the order book on Unichain Sepolia.</p>
        <button type="button" className="btn" onClick={book.retry}>
          Try again
        </button>
      </div>
    );
  }
  const text = book.isLoading
    ? "Reading the order book on Unichain Sepolia…"
    : "No orders in about the last 14 hours. Place one with the form above and it shows up here.";
  return <p className={`${chart.notice} small muted`}>{text}</p>;
}

interface BookLineProps {
  row: BookRow;
  isYours: boolean;
  isFollowed: boolean;
  onFollow: () => void;
}

function BookLine({ row, isYours, isFollowed, onFollow }: BookLineProps) {
  const { view, outcome, fillSeconds } = row;
  const amount = view.tokenIn ? formatToken(view.amountIn, ORDER_TOKENS[view.tokenIn]) : `${view.amountIn} units`;
  const name = view.kind ? KIND_SPEC[view.kind].name : "Order";
  const owner = isYours ? "you" : shortHex(view.owner);
  const paidToken = view.tokenIn ? ORDER_TOKENS[outputToken(view.tokenIn)] : undefined;
  const badge = orderStatusBadge(view.status, view.isExpired);
  // Cancelled, expired and refunded, or filled with the fill outside the window: nothing more will happen to it.
  const isClosed = view.status !== "Open";

  return (
    <li className={`${styles.bookRow} ${isFollowed ? styles.selected : ""}`} aria-current={isFollowed ? "true" : undefined}>
      <Cell label="Order">
        <button
          type="button"
          className={styles.followButton}
          aria-label={isFollowed ? `Order #${view.ref.id} is followed above` : `Follow order #${view.ref.id} above`}
          onClick={onFollow}
        >
          #{view.ref.id.toString()}
          <span className="small faint" aria-hidden="true">
            {isFollowed ? "Following" : "Follow"}
          </span>
        </button>
      </Cell>
      <Cell label="What it was">
        <span className={styles.orderTitle}>
          {name}, {view.kind === "limit-buy" ? "spend" : "sell"} {amount}
        </span>
        <span className="small muted num">
          At {formatPrice(view.triggerPrice)} · by {owner}
        </span>
      </Cell>
      <Cell label="Base price that fired it">
        <span className={`${styles.narrowLabel} small faint`} aria-hidden="true">
          Fired at
        </span>
        {outcome ? <span className="num">{formatPrice(outcome.observedPrice)}</span> : <span className={`small ${badge.tone}`}>{badge.label}</span>}
      </Cell>
      <Cell label="Unichain paid">
        <span className={`${styles.narrowLabel} small faint`} aria-hidden="true">
          Unichain paid
        </span>
        {outcome?.outcome === "Filled" && paidToken ? (
          <span className="num">{formatToken(outcome.amountOut, paidToken)}</span>
        ) : (
          <>
            {/* The order's state now comes first: a skipped attempt does not mean it is still waiting. */}
            <span className={`small ${isClosed ? badge.tone : "muted"}`}>{isClosed ? badge.label : outcome ? "Not filled yet" : "Not yet"}</span>
            {outcome ? <span className="small faint">Last attempt: {OUTCOME_TEXT[outcome.outcome].title}</span> : null}
          </>
        )}
      </Cell>
      <Cell label="Time to fill">
        {fillSeconds !== undefined ? (
          <span className={chart.answerTime}>
            <span className="num">{fillSeconds} s</span>
            <span className={chart.answerUnit}>to fill</span>
          </span>
        ) : (
          <span className="small muted">{isClosed ? "Did not fill" : "Waiting"}</span>
        )}
      </Cell>
      <Cell label="Proof">
        <span className={chart.proof}>
          <span className="small">
            <span className="faint">Placed </span>
            <HashLink chain="unichain" hash={view.ref.txHash} />
          </span>
          {outcome ? (
            <span className="small">
              <span className="faint">{outcome.outcome === "Filled" ? "Filled " : "Outcome "}</span>
              <HashLink chain="unichain" hash={outcome.txHash} />
            </span>
          ) : null}
        </span>
      </Cell>
    </li>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={chart.cell}>
      <span className={chart.cellLabel}>{label}</span>
      {children}
    </div>
  );
}
