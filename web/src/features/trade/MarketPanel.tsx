import { ARB_INPUT_USDC, MIN_SURPLUS_USDC, POOL_FEE_BPS, USDC_DECIMALS, WETH_DECIMALS } from "@/config/contracts";
import { bestRoute, gapBps, spotPriceUsdc, type Reserves } from "@/lib/amm";
import { formatAmount, formatCompact, formatPercent, PENDING_TEXT } from "@/lib/format";
import type { PoolPair } from "./quote";
import styles from "./trade.module.css";

/** What a pool holds, e.g. "Holds 100 WETH and 300,000 USDC". */
function holdingsText(reserves: Reserves | undefined): string | undefined {
  if (!reserves) return undefined;
  return `Holds ${formatCompact(reserves.weth, WETH_DECIMALS, 2)} WETH and ${formatAmount(reserves.usdc, USDC_DECIMALS, 0)} USDC`;
}

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
  const pendingText = isError ? PENDING_TEXT.unavailable : PENDING_TEXT.loading;

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
          note={holdingsText(pools?.A)}
        />
        <MarketCell
          label="Price on Pool B"
          value={priceB === undefined ? undefined : formatAmount(priceB, USDC_DECIMALS, 2)}
          pendingText={pendingText}
          note={holdingsText(pools?.B)}
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
  if (!isLoaded) return <span>{PENDING_TEXT.loading}</span>;
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
  /** A line under the value, e.g. what the pool holds. */
  note?: string;
  tone?: "ok";
}

/** One price cell, shared with the order page's price panel. */
export function MarketCell({ label, value, pendingText = PENDING_TEXT.loading, unit, note, tone }: MarketCellProps) {
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
      {note ? <span className="small faint num">{note}</span> : null}
    </div>
  );
}
