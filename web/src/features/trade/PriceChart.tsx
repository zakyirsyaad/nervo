"use client";

import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import { USDC_DECIMALS } from "@/config/contracts";
import { gapBps } from "@/lib/amm";
import { formatAmount, formatPercent } from "@/lib/format";
import { priceScale, type PriceStep } from "./history";
import styles from "./history.module.css";

// The SVG is drawn in a 1000 x 100 box and stretched to the plot; strokes keep their width either way.
const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 100;
// Least distance between the two end labels, as a share of the plot height, so they never overlap.
const LABEL_GAP = 0.14;

interface PriceChartProps {
  steps: readonly PriceStep[];
  /** Plain words for who made a step, e.g. "Your swap". */
  describeStep: (step: PriceStep) => string;
}

// Above this many USDC, cents add digits without adding meaning.
const WHOLE_PRICE_FROM = 100_000n * 10n ** BigInt(USDC_DECIMALS);

function formatPrice(price: bigint | null): string {
  if (price === null) return "not known";
  return formatAmount(price, USDC_DECIMALS, price >= WHOLE_PRICE_FROM ? 0 : 2);
}

function stepX(index: number, count: number): number {
  return count > 1 ? (index / (count - 1)) * VIEW_WIDTH : VIEW_WIDTH / 2;
}

/** A step line: flat until the next change, then straight up or down. Gaps where the price is not known. */
function stepPath(prices: readonly (bigint | null)[], y: (price: bigint) => number): string {
  const count = prices.length;
  const parts: string[] = [];
  let previousY: number | null = null;
  prices.forEach((price, index) => {
    if (price === null) {
      previousY = null;
      return;
    }
    const x = stepX(index, count);
    const nextY = y(price) * VIEW_HEIGHT;
    parts.push(previousY === null ? `M${x} ${nextY}` : `H${x} V${nextY}`);
    previousY = nextY;
  });
  if (count === 1 && previousY !== null) return `M0 ${previousY} H${VIEW_WIDTH}`;
  return parts.join(" ");
}

interface EndPlacement {
  readonly a: number | null;
  readonly b: number | null;
  /** True when both prices read the same, so one label carries both keys. */
  readonly isShared: boolean;
}

/** Where the latest-price labels sit, from 0 (top) to 1 (bottom), pushed apart when they would overlap. */
function placeEndLabels(yA: number | null, yB: number | null, isSamePrice: boolean): EndPlacement {
  if (yA === null || yB === null) return { a: yA, b: yB, isShared: false };
  if (isSamePrice) return { a: yA, b: null, isShared: true };
  if (Math.abs(yA - yB) >= LABEL_GAP) return { a: yA, b: yB, isShared: false };
  const middle = Math.min(Math.max((yA + yB) / 2, LABEL_GAP / 2), 1 - LABEL_GAP / 2);
  const aIsHigher = yA <= yB;
  const upper = middle - LABEL_GAP / 2;
  const lower = middle + LABEL_GAP / 2;
  return { a: aIsHigher ? upper : lower, b: aIsHigher ? lower : upper, isShared: false };
}

export function PriceChart({ steps, describeStep }: PriceChartProps) {
  const hintId = useId();
  // The selection follows a transaction, not a position: new steps push old ones left every few seconds.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const lastIndex = steps.length - 1;
  const selectedIndex = selectedKey === null ? -1 : steps.findIndex((step) => step.key === selectedKey);
  const isSelecting = selectedIndex >= 0;
  const shownIndex = isSelecting ? selectedIndex : lastIndex;
  const shown = steps[shownIndex];

  const prices = steps.flatMap((step) => [step.priceA, step.priceB]).filter((price): price is bigint => price !== null);
  const scale = priceScale(prices);
  const last = steps[lastIndex];
  const ends = placeEndLabels(
    last.priceA === null ? null : scale.y(last.priceA),
    last.priceB === null ? null : scale.y(last.priceB),
    formatPrice(last.priceA) === formatPrice(last.priceB),
  );

  function select(index: number) {
    setSelectedKey(steps[Math.min(Math.max(index, 0), lastIndex)].key);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1);
    select(Math.round(ratio * lastIndex));
  }

  // A lifted finger leaves the reading in place; a mouse leaving the plot returns to the latest step.
  function handlePointerLeave(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch") setSelectedKey(null);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key === "Escape") {
      setSelectedKey(null);
      return;
    }
    const moves: Record<string, number> = { ArrowLeft: shownIndex - 1, ArrowRight: shownIndex + 1, Home: 0, End: lastIndex };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    select(target);
  }

  const gap = shown.priceA !== null && shown.priceB !== null ? gapBps(shown.priceB, shown.priceA) : null;
  const who = isSelecting ? describeStep(shown) : `Now · after ${describeStep(shown).toLowerCase()}`;
  const valueText = `${describeStep(shown)}: Pool A ${formatPrice(shown.priceA)}, Pool B ${formatPrice(shown.priceB)}${
    gap === null ? "" : `, B against A ${formatPercent(gap)}`
  }`;
  const crosshairX = stepX(shownIndex, steps.length);

  return (
    <div className={styles.chart}>
      <p id={hintId} className="sr-only">
        Left and right arrow keys step through each change, Home and End jump to the oldest and newest.
      </p>
      <div className={styles.chartFrame}>
        <div
          className={styles.plot}
          tabIndex={0}
          role="slider"
          aria-label="Pool prices after each change"
          aria-describedby={hintId}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={lastIndex}
          aria-valuenow={shownIndex}
          aria-valuetext={valueText}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          onKeyDown={handleKeyDown}
          onBlur={() => setSelectedKey(null)}
        >
          <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
            {steps.map((step, index) =>
              step.byContract ? (
                <line
                  key={step.key}
                  className={styles.contractMark}
                  x1={stepX(index, steps.length)}
                  x2={stepX(index, steps.length)}
                  y1={0}
                  y2={VIEW_HEIGHT}
                />
              ) : null,
            )}
            {isSelecting ? <line className={styles.crosshair} x1={crosshairX} x2={crosshairX} y1={0} y2={VIEW_HEIGHT} /> : null}
            <path className={styles.lineA} d={stepPath(steps.map((step) => step.priceA), scale.y)} />
            <path className={styles.lineB} d={stepPath(steps.map((step) => step.priceB), scale.y)} />
          </svg>
          <span className={`${styles.axisLabel} ${styles.axisTop} small faint num`} aria-hidden="true">
            {formatPrice(BigInt(Math.round(scale.max)))}
          </span>
          <span className={`${styles.axisLabel} ${styles.axisBottom} small faint num`} aria-hidden="true">
            {formatPrice(BigInt(Math.round(scale.min)))}
          </span>
        </div>
        <div className={styles.ends} aria-hidden="true">
          {ends.a !== null ? <EndLabel top={ends.a} pools={ends.isShared ? ["A", "B"] : ["A"]} price={last.priceA} /> : null}
          {ends.b !== null ? <EndLabel top={ends.b} pools={["B"]} price={last.priceB} /> : null}
        </div>
      </div>

      <div className={styles.axisFoot} aria-hidden="true">
        <span className="small faint">Older</span>
        <span className="small faint">Newest</span>
      </div>

      <div className={styles.readout}>
        <span className={styles.readoutWho}>{who}</span>
        <span className={styles.readoutValues}>
          <span className={styles.readoutValue}>
            <span className={`${styles.key} ${styles.keyA}`} aria-hidden="true" />
            <span className="num">{formatPrice(shown.priceA)}</span>
            <span className="small faint">Pool A</span>
          </span>
          <span className={styles.readoutValue}>
            <span className={`${styles.key} ${styles.keyB}`} aria-hidden="true" />
            <span className="num">{formatPrice(shown.priceB)}</span>
            <span className="small faint">Pool B</span>
          </span>
          {gap !== null ? (
            <span className={styles.readoutValue}>
              <span className="num">{formatPercent(gap)}</span>
              <span className="small faint">B against A</span>
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

interface EndLabelProps {
  top: number;
  pools: readonly ("A" | "B")[];
  price: bigint | null;
}

/** The latest price at the right end of its line, so the chart reads without the legend. */
function EndLabel({ top, pools, price }: EndLabelProps) {
  return (
    <span className={`${styles.endLabel} small num`} style={{ top: `${top * 100}%` }}>
      {pools.map((pool) => (
        <span key={pool} className={`${styles.key} ${pool === "A" ? styles.keyA : styles.keyB}`} />
      ))}
      {formatPrice(price)}
    </span>
  );
}
