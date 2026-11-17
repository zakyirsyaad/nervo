"use client";

import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { PriceStep } from "@/features/trade/history";
import { bandScale } from "@/lib/scale";
import { formatPrice } from "./tokens";
import chart from "../trade/history.module.css";
import styles from "./orders.module.css";

const VIEW_WIDTH = 1000;
// The range follows the price within 15% of the latest one; a swing past that is held at the edge.
const BAND = 0.15;

export interface ChartTrigger {
  readonly orderId: bigint;
  readonly price: bigint;
}

interface TriggerChartProps {
  /** Pool A price after each change to it, oldest first. */
  steps: readonly PriceStep[];
  /** Orders each step fired, by step key. */
  fired: ReadonlyMap<string, readonly bigint[]>;
  trigger: ChartTrigger | undefined;
  describeStep: (step: PriceStep) => string;
}

function stepX(index: number, count: number): number {
  return count > 1 ? (index / (count - 1)) * VIEW_WIDTH : VIEW_WIDTH / 2;
}

/** Flat until the next change, then straight up or down; a gap where the price is not known. */
function stepPath(steps: readonly PriceStep[], yOf: (price: bigint) => number): string {
  const parts: string[] = [];
  let isDrawing = false;
  steps.forEach((step, index) => {
    if (step.priceA === null) {
      isDrawing = false;
      return;
    }
    const x = stepX(index, steps.length);
    const y = yOf(step.priceA);
    parts.push(isDrawing ? `H${x} V${y}` : `M${x} ${y}`);
    isDrawing = true;
  });
  if (steps.length === 1 && steps[0].priceA !== null) return `M0 ${yOf(steps[0].priceA)} H${VIEW_WIDTH}`;
  return parts.join(" ");
}

function ordersText(ids: readonly bigint[]): string {
  return ids.map((id) => `#${id}`).join(", ");
}

export function TriggerChart({ steps, fired, trigger, describeStep }: TriggerChartProps) {
  const hintId = useId();
  // Follows a transaction, not a position: new changes push old ones left.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const lastIndex = steps.length - 1;
  const selectedIndex = selectedKey === null ? -1 : steps.findIndex((step) => step.key === selectedKey);
  const isSelecting = selectedIndex >= 0;
  const shownIndex = isSelecting ? selectedIndex : lastIndex;
  const shown = steps[shownIndex];

  const values = steps.flatMap((step) => (step.priceA === null ? [] : [Number(step.priceA)]));
  const scale = bandScale(values, values.at(-1) ?? 0, BAND, trigger ? [Number(trigger.price)] : []);
  const yOf = (price: bigint) => scale.y(Number(price)) * 100;
  const path = stepPath(steps, yOf);
  // Numbers only on the latest change that fired an order and on the followed order's, so labels never pile up.
  const firedKeys = steps.filter((step) => fired.has(step.key)).map((step) => step.key);
  const labelled = new Set([
    ...firedKeys.slice(-1),
    ...firedKeys.filter((key) => trigger && fired.get(key)?.includes(trigger.orderId)),
  ]);

  function select(index: number) {
    setSelectedKey(steps[Math.min(Math.max(index, 0), lastIndex)].key);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    select(Math.round(((event.clientX - box.left) / box.width) * lastIndex));
  }

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

  const shownFired = fired.get(shown.key);
  const isShownClipped = shown.priceA !== null && scale.isClipped(Number(shown.priceA));
  const priceText = shown.priceA === null ? "not known" : `${formatPrice(shown.priceA)}${isShownClipped ? ", off the chart's range" : ""}`;
  const firedText = shownFired ? `Fired order ${ordersText(shownFired)}` : undefined;
  const valueText = `${describeStep(shown)}. Base Pool A ${priceText}.${firedText ? ` ${firedText}.` : ""}`;

  return (
    <div className={chart.chart}>
      <p id={hintId} className="sr-only">
        Left and right arrow keys step through each change to the price, Home and End jump to the oldest and newest.
      </p>
      <div className={chart.chartFrame}>
        <div className={chart.axis} aria-hidden="true">
          <span className="small faint num">{formatPrice(BigInt(Math.round(scale.max)))}</span>
          <span className="small faint num">{formatPrice(BigInt(Math.round(scale.min)))}</span>
        </div>
        <div
          className={chart.plot}
          tabIndex={0}
          role="slider"
          aria-label="Price on Base after each change"
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
          <svg viewBox={`0 0 ${VIEW_WIDTH} 100`} preserveAspectRatio="none" aria-hidden="true">
            {isSelecting ? (
              <line className={chart.zero} x1={stepX(shownIndex, steps.length)} x2={stepX(shownIndex, steps.length)} y1={0} y2={100} />
            ) : null}
            <path className={styles.priceLine} d={path} />
          </svg>
          {trigger ? (
            <>
              <div className={styles.triggerLine} style={{ top: `${yOf(trigger.price)}%` }} aria-hidden="true" />
              <span className={`${styles.triggerLabel} small num`} style={{ top: `${yOf(trigger.price)}%` }} aria-hidden="true">
                #{trigger.orderId.toString()} trigger {formatPrice(trigger.price)}
              </span>
            </>
          ) : null}
          {steps.map((step, index) => {
            if (step.priceA === null || !scale.isClipped(Number(step.priceA))) return null;
            const isBelow = scale.y(Number(step.priceA)) >= 1;
            return (
              <span
                key={`clip-${step.key}`}
                className={`${styles.clipMark} ${isBelow ? styles.clipBelow : styles.clipAbove}`}
                style={{ left: `${(stepX(index, steps.length) / VIEW_WIDTH) * 100}%` }}
                aria-hidden="true"
              />
            );
          })}
          {steps.map((step, index) => {
            const ids = fired.get(step.key);
            if (!ids || step.priceA === null) return null;
            const left = (stepX(index, steps.length) / VIEW_WIDTH) * 100;
            return (
              <span key={step.key} aria-hidden="true">
                <span className={styles.fireDot} style={{ left: `${left}%`, top: `${yOf(step.priceA)}%` }} />
                {labelled.has(step.key) ? (
                  <span className={`${styles.fireLabel} small num`} style={{ left: `${left}%`, top: `${yOf(step.priceA)}%` }}>
                    {ordersText(ids)}
                  </span>
                ) : null}
              </span>
            );
          })}
        </div>
      </div>
      <div className={chart.axisFoot} aria-hidden="true">
        <span className="small faint">Older</span>
        <span className="small faint">Latest</span>
      </div>
      <div className={chart.readout}>
        <span className={chart.readoutWho}>{isSelecting ? describeStep(shown) : `Latest: ${describeStep(shown).toLowerCase()}`}</span>
        <span className={chart.readoutGap}>Base Pool A {priceText}</span>
        {firedText ? <span className="small accent">{firedText}</span> : null}
      </div>
    </div>
  );
}
