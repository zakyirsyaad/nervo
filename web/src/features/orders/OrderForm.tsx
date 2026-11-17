"use client";

import { useState } from "react";
import { WalletButton } from "@/components/WalletButton";
import { orderChain } from "@/config/chains";
import { DEFAULT_ORDER_FEE_WEI, MAX_WATCHED_PER_OWNER, ORDER_POOL_FEE_BPS } from "@/config/orders";
import { spotPriceUsdc, type TokenSymbol } from "@/lib/amm";
import { formatAmount, formatCompact, parseAmount } from "@/lib/format";
import {
  defaultTriggerPrice,
  EXPIRY_CHOICES,
  KIND_SPEC,
  outputToken,
  quoteMinOut,
  triggersImmediately,
  type ExpiryChoice,
  type OrderKind,
} from "./kinds";
import { OrderFaucetRow } from "./OrderFaucetRow";
import { OrderField } from "./OrderField";
import { orderBlocker } from "./orderDraft";
import type { OrderRef } from "./orderList";
import { ExpiryPicker, KindPicker } from "./OrderPickers";
import { formatPrice, ORDER_TOKENS, PRICE_DECIMALS } from "./tokens";
import type { OrderContracts } from "./useOrderContracts";
import type { OrderPrices } from "./useOrderPrices";
import type { OrderWallet } from "./useOrderWallet";
import { usePlaceOrder, type PlacePhase } from "./usePlaceOrder";
import tradeStyles from "../trade/trade.module.css";
import styles from "./orders.module.css";

const DEFAULT_AMOUNT: Record<TokenSymbol, string> = { weth: "0.5", usdc: "1,000" };

const PHASE_LABEL: Record<Exclude<PlacePhase, "idle">, string> = {
  switching: `Switch to ${orderChain.name} in your wallet`,
  checking: "Getting ready…",
  "approve-sign": "Step 1 of 2: allow this amount in your wallet",
  "approve-confirm": "Step 1 of 2: almost there…",
  "place-sign": "Now confirm the order in your wallet",
  "place-confirm": "Placing your order…",
};

interface OrderFormProps {
  contracts: OrderContracts;
  prices: OrderPrices;
  wallet: OrderWallet;
  watchedCount: number | undefined;
  onPlaced: (order: OrderRef) => void;
}

export function OrderForm({ contracts, prices, wallet, watchedCount, onPlaced }: OrderFormProps) {
  const [kind, setKind] = useState<OrderKind>("stop-loss");
  const [amountText, setAmountText] = useState(DEFAULT_AMOUNT.weth);
  // Undefined while the visitor has not typed: the field then follows the live price or quote.
  const [triggerText, setTriggerText] = useState<string>();
  const [minOutText, setMinOutText] = useState<string>();
  const [expiryId, setExpiryId] = useState<ExpiryChoice["id"]>("1d");
  const { phase, error, place } = usePlaceOrder();

  const spec = KIND_SPEC[kind];
  const input = ORDER_TOKENS[spec.tokenIn];
  const output = ORDER_TOKENS[outputToken(spec.tokenIn)];
  const minimum = spec.tokenIn === "weth" ? contracts.minWethIn : contracts.minUsdcIn;
  const minimumLabel = `${formatCompact(minimum, input.decimals, input.inputDecimals)} ${input.symbol}`;
  const amountIn = parseAmount(amountText, input.decimals);
  const basePrice = prices.base ? spotPriceUsdc(prices.base) : undefined;
  const defaultTrigger = basePrice === undefined ? undefined : defaultTriggerPrice(basePrice, kind);
  const triggerShown = triggerText ?? (defaultTrigger === undefined ? "" : formatPrice(defaultTrigger));
  const triggerPrice = parseAmount(triggerShown, PRICE_DECIMALS);
  const quote = prices.unichain && amountIn ? quoteMinOut(prices.unichain, spec.tokenIn, amountIn, ORDER_POOL_FEE_BPS) : undefined;
  const minOutShown = minOutText ?? (quote ? formatAmount(quote.minAmountOut, output.decimals, output.inputDecimals) : "");
  const minAmountOut = parseAmount(minOutShown, output.decimals);
  const lifetime = EXPIRY_CHOICES.find((choice) => choice.id === expiryId) ?? EXPIRY_CHOICES[0];
  const balance = wallet.balances?.[spec.tokenIn];
  const firesNow = basePrice !== undefined && Boolean(triggerPrice) && triggersImmediately(kind, triggerPrice ?? 0n, basePrice);
  const direction = spec.condition === "PriceAtOrBelow" ? "below" : "above";
  const isBusy = phase !== "idle";

  const blocker = orderBlocker({
    deployment: contracts.deployment,
    hasPrices: basePrice !== undefined && prices.unichain !== undefined,
    watchedCount,
    amountText,
    amountIn,
    minimum,
    minimumLabel,
    example: input.example,
    balance,
    triggerPrice,
    minAmountOut,
    orderFee: contracts.orderFee,
    ethBalance: wallet.ethBalance,
  });

  function handleKind(next: OrderKind) {
    if (next === kind) return;
    const nextToken = KIND_SPEC[next].tokenIn;
    if (nextToken !== spec.tokenIn) setAmountText(DEFAULT_AMOUNT[nextToken]);
    setKind(next);
    setTriggerText(undefined);
    setMinOutText(undefined);
  }

  async function handlePlace() {
    if (!wallet.account || !amountIn || !triggerPrice || !minAmountOut || contracts.orderFee === undefined) return;
    const placed = await place({
      account: wallet.account,
      tokenIn: input.address,
      amountIn,
      condition: spec.condition,
      triggerPrice,
      minAmountOut,
      lifetime,
      fee: contracts.orderFee,
    });
    wallet.refetch();
    if (placed) onPlaced(placed);
  }

  const triggerHint = firesNow ? (
    "The price on Base is already past this trigger, so the order would fill at the next price change."
  ) : triggerText === undefined ? (
    `Prefilled 1% ${direction} the current price on Base.`
  ) : (
    <ResetButton label={`Reset to 1% ${direction} the current price`} onClick={() => setTriggerText(undefined)} />
  );

  return (
    <div className="panel">
      {/* Locked while an order is in flight, so the panel always shows the order being signed. */}
      <fieldset disabled={isBusy} className={tradeStyles.fieldset}>
        <legend className="sr-only">New protective order</legend>
        <div className={`panel-head ${styles.headWrap}`}>
          <span className="label" aria-hidden="true">
            [ New order ]
          </span>
          <KindPicker value={kind} onChange={handleKind} />
        </div>
        <p className="panel-row small muted">
          {spec.summary} It watches the price on Base Sepolia and trades on Unichain Sepolia.
        </p>

        <div className={`panel-row ${tradeStyles.form}`}>
          <OrderField
            id="order-amount"
            label={spec.tokenIn === "weth" ? "Amount to sell" : "Amount to spend"}
            aside={`On Unichain: ${balance === undefined ? "—" : formatAmount(balance, input.decimals, input.display)}`}
            value={amountText}
            onChange={(value) => {
              setAmountText(value);
              setMinOutText(undefined);
            }}
            symbol={input.symbol}
            isInvalid={amountText !== "" && amountIn === null}
            hint={`Smallest order: ${minimumLabel}.`}
          />
          <OrderField
            id="order-trigger"
            label="Trigger price on Base"
            aside={basePrice === undefined ? undefined : `Now ${formatPrice(basePrice)}`}
            value={triggerShown}
            onChange={setTriggerText}
            symbol="USDC"
            isInvalid={triggerShown !== "" && triggerPrice === null}
            hint={triggerHint}
            isWarning={firesNow}
          />
          <OrderField
            id="order-min-out"
            label="You receive at least"
            aside={quote ? `Unichain pays ${formatAmount(quote.amountOut, output.decimals, output.display)} now` : undefined}
            value={minOutShown}
            onChange={setMinOutText}
            symbol={output.symbol}
            isInvalid={minOutShown !== "" && minAmountOut === null}
            hint={
              <>
                Starts 1% under what Unichain&apos;s pool pays now. If it pays less when your trigger is hit, nothing is
                traded and the order stays open.{" "}
                {minOutText === undefined ? null : <ResetButton label="Reset" onClick={() => setMinOutText(undefined)} />}
              </>
            }
          />
          <ExpiryPicker value={expiryId} onChange={setExpiryId} />
        </div>
      </fieldset>

      <dl className={tradeStyles.summary}>
        <SummaryRow
          term="Smallest order"
          value={`${formatCompact(contracts.minWethIn, 18, 6)} WETH or ${formatCompact(contracts.minUsdcIn, 6, 2)} USDC`}
        />
        <SummaryRow
          term="Orders watched at once"
          value={`${MAX_WATCHED_PER_OWNER} per wallet${watchedCount === undefined ? "" : ` · you have ${watchedCount}`}`}
        />
        <SummaryRow term="Unichain pool fee" value={`${(Number(ORDER_POOL_FEE_BPS) / 100).toFixed(2)}%`} />
      </dl>

      <div className={`panel-row ${tradeStyles.action}`}>
        <p className="small muted">
          Network fee for the trigger: {formatCompact(contracts.orderFee ?? DEFAULT_ORDER_FEE_WEI, 18, 6)} ETH, prepays the
          execution
        </p>
        {!wallet.account ? (
          <WalletButton block />
        ) : (
          <>
            <button
              type="button"
              className="btn primary block"
              disabled={Boolean(blocker) || isBusy}
              onClick={handlePlace}
              aria-describedby={blocker && !isBusy ? "order-blocker" : undefined}
            >
              {isBusy ? PHASE_LABEL[phase] : `Place ${spec.name.toLowerCase()}`}
            </button>
            {blocker && !isBusy ? (
              <p id="order-blocker" className="small muted">
                {blocker}
              </p>
            ) : null}
            {!blocker && !isBusy ? <p className="small faint">{signingNote(wallet.isOnOrderChain)}</p> : null}
          </>
        )}
        {error ? (
          <p role="alert" className="small danger">
            {error}
          </p>
        ) : null}
      </div>

      <OrderFaucetRow wallet={wallet} isDeployed={contracts.isDeployed} />
    </div>
  );
}

function signingNote(isOnOrderChain: boolean): string {
  const asks = "asks up to twice: once to allow this exact amount, then to place the order.";
  return isOnOrderChain ? `Your wallet ${asks}` : `Your wallet first switches to ${orderChain.name}, then ${asks}`;
}

interface ResetButtonProps {
  label: string;
  onClick: () => void;
}

function ResetButton({ label, onClick }: ResetButtonProps) {
  return (
    <button type="button" className={styles.textButton} onClick={onClick}>
      {label}
    </button>
  );
}

interface SummaryRowProps {
  term: string;
  value: string;
}

function SummaryRow({ term, value }: SummaryRowProps) {
  return (
    <div>
      <dt className="muted">{term}</dt>
      <dd className="mono num">{value}</dd>
    </div>
  );
}
