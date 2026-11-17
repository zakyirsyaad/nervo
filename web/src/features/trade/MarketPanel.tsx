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

  return (
    <div className="panel">
      <div className="panel-head label">
        <span>[ Live prices · 1 WETH in USDC ]</span>
        {isError ? (
          <span className="danger">Cannot reach the network</span>
        ) : (
          <span className={`accent ${styles.live}`}>
            <span className={`${styles.dot} pulse`} />
            Live
          </span>
        )}
      </div>
      <div className="cells narrow flush">
        <MarketCell label="Price on Pool A" value={priceA === undefined ? "—" : formatAmount(priceA, USDC_DECIMALS, 2)} />
        <MarketCell label="Price on Pool B" value={priceB === undefined ? "—" : formatAmount(priceB, USDC_DECIMALS, 2)} />
        <MarketCell
          label="Difference"
          value={gap === undefined ? "—" : formatPercent(gap)}
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

interface MarketCellProps {
  label: string;
  value: string;
  unit?: string;
  tone?: "ok";
}

function MarketCell({ label, value, unit, tone }: MarketCellProps) {
  return (
    <div className={`cell ${styles.marketCell}`}>
      <span className="small muted">{label}</span>
      <span className={`${styles.marketValue} num ${tone ?? ""}`}>
        {value} {unit ? <span className={styles.marketUnit}>{unit}</span> : null}
      </span>
    </div>
  );
}
