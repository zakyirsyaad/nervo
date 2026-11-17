import { gapBps, spotPriceUsdc } from "@/lib/amm";
import { formatPercent } from "@/lib/format";
import { MarketCell } from "../trade/MarketPanel";
import type { Deployment } from "./orderDraft";
import { formatPrice } from "./tokens";
import type { OrderPrices } from "./useOrderPrices";
import tradeStyles from "../trade/trade.module.css";

interface PricePanelProps {
  prices: OrderPrices;
  deployment: Deployment;
}

export function PricePanel({ prices, deployment }: PricePanelProps) {
  const basePrice = prices.base ? spotPriceUsdc(prices.base) : undefined;
  const unichainPrice = prices.unichain ? spotPriceUsdc(prices.unichain) : undefined;
  const gap = basePrice !== undefined && unichainPrice !== undefined ? gapBps(unichainPrice, basePrice) : undefined;
  const isMissing = deployment === "missing";

  return (
    <div className="panel">
      <div className="panel-head label">
        <span>[ Live prices · 1 WETH in USDC ]</span>
        {prices.isBaseError ? (
          <span className="danger">Cannot reach Base Sepolia</span>
        ) : (
          <span className={`accent ${tradeStyles.live}`}>
            <span className={`${tradeStyles.dot} pulse`} />
            Live
          </span>
        )}
      </div>
      <div className="cells narrow flush">
        <MarketCell
          label="Base Sepolia · Pool A"
          value={basePrice === undefined ? "—" : formatPrice(basePrice)}
          unit="orders watch this"
        />
        <MarketCell
          label="Unichain Sepolia pool"
          value={unichainPrice === undefined ? "—" : formatPrice(unichainPrice)}
          unit={isMissing ? "not deployed yet" : prices.isUnichainError ? "cannot reach" : "orders trade here"}
        />
        <MarketCell label="Unichain against Base" value={gap === undefined ? "—" : formatPercent(gap)} />
      </div>
      <p className="panel-row small muted">
        Your order watches the price on Base, but trades on Unichain&apos;s own pool. The two prices can differ a
        little, which is why you also set the least you are willing to receive.
      </p>
    </div>
  );
}
