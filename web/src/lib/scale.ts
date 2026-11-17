export interface Scale {
  readonly min: number;
  readonly max: number;
  /** Vertical position from 0 (top) to 1 (bottom), held at the edge for values outside the range. */
  readonly y: (value: number) => number;
  /** True when the value lies outside the range and is drawn at the edge. */
  readonly isClipped: (value: number) => boolean;
}

// Room above and below the plotted range, as a share of it.
const PADDING = 0.08;
// Half-height of the range when every value is the same, as a share of the value (1%).
const FLAT_HALF_RANGE = 0.01;

/**
 * Linear scale around `center`. Values within `band` (a share of `center`) set the range, and `always` is kept in
 * it whatever its distance; anything else is held at the nearest edge, so one wild swing cannot flatten the rest.
 */
export function bandScale(values: readonly number[], center: number, band: number, always: readonly number[] = []): Scale {
  const near = values.filter((value) => Math.abs(value - center) <= center * band);
  const kept = [...near, center, ...always].filter((value) => Number.isFinite(value) && value > 0);
  if (kept.length === 0) return { min: 0, max: 0, y: () => 0.5, isClipped: () => false };
  const low = Math.min(...kept);
  const high = Math.max(...kept);
  const pad = high > low ? (high - low) * PADDING : center * FLAT_HALF_RANGE;
  const bottom = low - pad;
  const top = high + pad;
  return {
    min: bottom,
    max: top,
    y: (value) => Math.min(Math.max((top - value) / (top - bottom), 0), 1),
    isClipped: (value) => value < bottom || value > top,
  };
}
