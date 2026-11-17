import { gapBps, spotPriceUsdc } from "@/lib/amm";
import { formatPercent, PENDING_TEXT } from "@/lib/format";
import { FeedStatus, MarketCell } from "../trade/MarketPanel";
import type { Deployment } from "./orderDraft";
import { formatPrice } from "./tokens";
import type { OrderPrices } from "./useOrderPrices";

interface PricePanelProps {
  prices: OrderPrices;
  deployment: Deployment;
}

export function PricePanel({ prices, deployment }: PricePanelProps) {
  const basePrice = prices.base ? spotPriceUsdc(prices.base) : undefined;
  const unichainPrice = prices.unichain ? spotPriceUsdc(prices.unichain) : undefined;
  const gap = basePrice !== undefined && unichainPrice !== undefined ? gapBps(unichainPrice, basePrice) : undefined;
  const isMissing = deployment === "missing";
  const basePending = prices.isBaseError ? PENDING_TEXT.unavailable : PENDING_TEXT.loading;
  const unichainPending = isMissing
    ? "Not deployed yet"
    : prices.isUnichainError
      ? PENDING_TEXT.unavailable
      : PENDING_TEXT.loading;
  const gapPending = prices.isBaseError || prices.isUnichainError || isMissing ? "Needs both prices" : PENDING_TEXT.loading;

  return (
    <div className="panel">
      <div className="panel-head label">
        <span>Live prices · 1 WETH in USDC</span>
        <FeedStatus isError={prices.isBaseError} isLoaded={basePrice !== undefined} errorText="Cannot reach Base Sepolia" />
      </div>
      <div className="cells narrow flush">
        <MarketCell
          label="Base Sepolia · Pool A"
          value={basePrice === undefined ? undefined : formatPrice(basePrice)}
          pendingText={basePending}
          unit="orders watch this"
        />
        <MarketCell
          label="Unichain Sepolia pool"
          value={unichainPrice === undefined ? undefined : formatPrice(unichainPrice)}
          pendingText={unichainPending}
          unit={prices.isUnichainError ? "cannot reach" : "orders trade here"}
        />
        <MarketCell
          label="Unichain against Base"
          value={gap === undefined ? undefined : formatPercent(gap)}
          pendingText={gapPending}
        />
      </div>
      <p className="panel-row small muted">
        Your order watches the price on Base, but trades on Unichain&apos;s own pool. The two prices can differ a
        little, which is why you also set the least you are willing to receive.
      </p>
    </div>
  );
}
