import { ARB_INPUT_USDC, MIN_SURPLUS_USDC, POOL_FEE_BPS, USDC_DECIMALS } from "@/config/contracts";
import { bestRoute, gapBps, spotPriceUsdc } from "@/lib/amm";
import { formatAmount, formatPercent } from "@/lib/format";
import type { PoolPair } from "./quote";
import styles from "./trade.module.css";

interface MarketPanelProps {
  pools: PoolPair | undefined;
  isError: boolean;
}

export function MarketPanel({ pools, isError }: MarketPanelProps) {
  const priceA = pools ? spotPriceUsdc(pools.A) : undefined;
  const priceB = pools ? spotPriceUsdc(pools.B) : undefined;
  const gap = priceA !== undefined && priceB !== undefined ? gapBps(priceB, priceA) : undefined;
  // Green only when the gap is large enough to trade, not for any nonzero difference.
  const clearsThreshold =
    pools !== undefined &&
    bestRoute(ARB_INPUT_USDC, pools.A, pools.B, POOL_FEE_BPS).usdcOut >= ARB_INPUT_USDC + MIN_SURPLUS_USDC;
  const pendingText = isError ? "Unavailable" : "Loading…";

  return (
    <div className="panel">
      <div className="panel-head label">
        <span>Live prices · 1 WETH in USDC</span>
        <FeedStatus isError={isError} isLoaded={pools !== undefined} errorText="Cannot reach the network" />
      </div>
      <div className="cells narrow flush quad">
        <MarketCell
          label="Price on Pool A"
          value={priceA === undefined ? undefined : formatAmount(priceA, USDC_DECIMALS, 2)}
          pendingText={pendingText}
        />
        <MarketCell
          label="Price on Pool B"
          value={priceB === undefined ? undefined : formatAmount(priceB, USDC_DECIMALS, 2)}
          pendingText={pendingText}
        />
        <MarketCell
          label="Difference"
          value={gap === undefined ? undefined : formatPercent(gap)}
          pendingText={pendingText}
          unit={clearsThreshold ? "worth trading" : "too small to trade"}
          tone={clearsThreshold ? "ok" : undefined}
        />
        <MarketCell
          label="A trade starts at"
          value={formatAmount(MIN_SURPLUS_USDC, USDC_DECIMALS, 0)}
          unit="USDC profit"
        />
      </div>
    </div>
  );
}

interface FeedStatusProps {
  isError: boolean;
  isLoaded: boolean;
  errorText: string;
}

/** Says "Live" only once a price has actually been read. Shared with the order page's price panel. */
export function FeedStatus({ isError, isLoaded, errorText }: FeedStatusProps) {
  if (isError) return <span className="danger">{errorText}</span>;
  if (!isLoaded) return <span>Loading…</span>;
  return (
    <span className={`accent ${styles.live}`}>
      <span className={styles.dot} aria-hidden="true" />
      Live
    </span>
  );
}

interface MarketCellProps {
  label: string;
  /** Undefined until the value is known; the cell then shows pendingText instead of a number. */
  value: string | undefined;
  pendingText?: string;
  unit?: string;
  tone?: "ok";
}

/** One price cell, shared with the order page's price panel. */
export function MarketCell({ label, value, pendingText = "Loading…", unit, tone }: MarketCellProps) {
  return (
    <div className={`cell ${styles.marketCell}`}>
      <span className="small muted">{label}</span>
      {value === undefined ? (
        <span className={`${styles.marketPending} faint`}>{pendingText}</span>
      ) : (
        <span className={`${styles.marketValue} num ${tone ?? ""}`}>
          {value} {unit ? <span className={styles.marketUnit}>{unit}</span> : null}
        </span>
      )}
    </div>
  );
}
