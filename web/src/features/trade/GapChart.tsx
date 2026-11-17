"use client";

import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import { USDC_DECIMALS } from "@/config/contracts";
import { gapBps } from "@/lib/amm";
import { formatAmount } from "@/lib/format";
import type { PriceStep } from "./history";
import styles from "./history.module.css";

// Bars are drawn in a 1000 x 100 box stretched to the plot. The zero line sits in the middle.
const VIEW_WIDTH = 1000;
const MID = 50;
const HALF = 44;
// The scale shows at least ±1% and at most ±5%; bigger gaps are cut at the edge and marked.
const MIN_DOMAIN_BPS = 100;
const MAX_DOMAIN_BPS = 500;
// A level step still gets a short bar, so every change stays visible and hoverable.
const MIN_BAR = 1.5;
const BAR_SHARE = 0.6;

type BarKind = "swap" | "contract" | "reset";

function barKind(step: PriceStep): BarKind {
  if (step.byContract) return "contract";
  return step.hasSwap ? "swap" : "reset";
}

function gapOf(step: PriceStep): number | null {
  return step.priceA !== null && step.priceB !== null ? gapBps(step.priceB, step.priceA) : null;
}

function percent(bps: number): string {
  return `${(Math.abs(bps) / 100).toFixed(2)}%`;
}

/** "Pool B is 2.01% above Pool A", in words a first-time visitor can read. */
export function describeGap(bps: number | null): string {
  if (bps === null) return "Gap not known";
  if (bps === 0) return "Both pools at the same price";
  return `Pool B ${percent(bps)} ${bps > 0 ? "above" : "below"} Pool A`;
}

function price(value: bigint | null): string {
  return value === null ? "not known" : formatAmount(value, USDC_DECIMALS, 2);
}

interface GapChartProps {
  steps: readonly PriceStep[];
  describeStep: (step: PriceStep) => string;
}

export function GapChart({ steps, describeStep }: GapChartProps) {
  const hintId = useId();
  // Follows a transaction, not a position: new steps push old ones left every few seconds.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const lastIndex = steps.length - 1;
  const selectedIndex = selectedKey === null ? -1 : steps.findIndex((step) => step.key === selectedKey);
  const isSelecting = selectedIndex >= 0;
  const shownIndex = isSelecting ? selectedIndex : lastIndex;
  const shown = steps[shownIndex];

  const gaps = steps.map(gapOf);
  const largest = Math.max(0, ...gaps.map((gap) => Math.abs(gap ?? 0)));
  const domain = Math.min(Math.max(largest * 1.1, MIN_DOMAIN_BPS), MAX_DOMAIN_BPS);
  const slot = VIEW_WIDTH / steps.length;

  function select(index: number) {
    setSelectedKey(steps[Math.min(Math.max(index, 0), lastIndex)].key);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    select(Math.floor(((event.clientX - box.left) / box.width) * steps.length));
  }

  // A lifted finger keeps its reading; a mouse leaving the plot returns to the latest change.
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

  const shownGap = gaps[shownIndex];
  const who = isSelecting ? describeStep(shown) : `Latest: ${describeStep(shown).toLowerCase()}`;
  const valueText = `${describeStep(shown)}. ${describeGap(shownGap)}. Pool A ${price(shown.priceA)}, Pool B ${price(shown.priceB)}.`;

  return (
    <div className={styles.chart}>
      <p id={hintId} className="sr-only">
        Left and right arrow keys step through each change, Home and End jump to the oldest and newest.
      </p>
      <div className={styles.chartFrame}>
        <div className={styles.axis} aria-hidden="true">
          <span className="small faint num">+{percent(domain)}</span>
          <span className="small faint num">0%</span>
          <span className="small faint num">-{percent(domain)}</span>
        </div>
        <div
          className={styles.plot}
          tabIndex={0}
          role="slider"
          aria-label="Gap between the pools after each change"
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
            {isSelecting ? <rect className={styles.selection} x={shownIndex * slot} y={0} width={slot} height={100} /> : null}
            <line className={styles.zero} x1={0} x2={VIEW_WIDTH} y1={MID} y2={MID} />
            {steps.map((step, index) => {
              const gap = gaps[index] ?? 0;
              const isCut = Math.abs(gap) > domain;
              const length = Math.max((Math.min(Math.abs(gap), domain) / domain) * HALF, MIN_BAR);
              const y = gap >= 0 ? MID - length : MID;
              const x = index * slot + (slot * (1 - BAR_SHARE)) / 2;
              return (
                <g key={step.key}>
                  <rect className={styles[barKind(step)]} x={x} y={y} width={slot * BAR_SHARE} height={length} />
                  {isCut ? <rect className={styles.cut} x={x} y={gap >= 0 ? y + 4 : y + length - 6} width={slot * BAR_SHARE} height={2} /> : null}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      <div className={styles.axisFoot} aria-hidden="true">
        <span className="small faint">Older</span>
        <span className="small faint">Latest</span>
      </div>

      <div className={styles.readout}>
        <span className={styles.readoutWho}>{who}</span>
        <span className={styles.readoutGap}>{describeGap(shownGap)}</span>
        <span className="small muted num">
          Pool A {price(shown.priceA)} · Pool B {price(shown.priceB)}
        </span>
      </div>
    </div>
  );
}
