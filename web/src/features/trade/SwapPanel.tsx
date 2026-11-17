"use client";

import { useState } from "react";
import { WalletButton } from "@/components/WalletButton";
import { ADDRESSES, POOL_FEE_BPS, USDC_DECIMALS, WETH_DECIMALS } from "@/config/contracts";
import type { TokenSymbol } from "@/lib/amm";
import { formatAmount, formatPercent, parseAmount } from "@/lib/format";
import { FaucetRow } from "./FaucetRow";
import { applySlippage, otherPool, previewSwap, type PoolKey, type PoolPair } from "./quote";
import type { TrackedSwap } from "./useLoop";
import { useSwap, type SwapPhase } from "./useSwap";
import type { WalletState } from "./useWallet";
import styles from "./trade.module.css";

const SLIPPAGE_BPS = 50n;
const POOL_KEYS: readonly PoolKey[] = ["A", "B"];
const POOL_ADDRESS = { A: ADDRESSES.poolA, B: ADDRESSES.poolB } as const;

const TOKENS = {
  usdc: { symbol: "USDC", address: ADDRESSES.usdc, decimals: USDC_DECIMALS, display: 2 },
  weth: { symbol: "WETH", address: ADDRESSES.weth, decimals: WETH_DECIMALS, display: 4 },
} as const;

const PHASE_LABEL: Record<Exclude<SwapPhase, "idle">, string> = {
  checking: "Getting ready…",
  "approve-sign": "Step 1 of 2: allow this amount in your wallet",
  "approve-confirm": "Step 1 of 2: almost there…",
  "swap-sign": "Now confirm the swap in your wallet",
  "swap-confirm": "Swapping…",
};

interface SwapPanelProps {
  pools: PoolPair | undefined;
  wallet: WalletState;
  /** True while an earlier swap is still being followed; a new one would replace it on screen. */
  isLoopPending: boolean;
  onSwapped: (swap: TrackedSwap) => void;
}

export function SwapPanel({ pools, wallet, isLoopPending, onSwapped }: SwapPanelProps) {
  const [pool, setPool] = useState<PoolKey>("B");
  const [tokenIn, setTokenIn] = useState<TokenSymbol>("usdc");
  const [amountText, setAmountText] = useState("3,000");
  const { phase, error, swap } = useSwap();

  const tokenOut: TokenSymbol = tokenIn === "usdc" ? "weth" : "usdc";
  const input = TOKENS[tokenIn];
  const output = TOKENS[tokenOut];
  const amountIn = parseAmount(amountText, input.decimals);
  const preview = pools && amountIn ? previewSwap({ pools, pool, tokenIn, amountIn }) : undefined;
  const minAmountOut = preview ? applySlippage(preview.amountOut, SLIPPAGE_BPS) : undefined;
  const balanceIn = wallet.balances?.[tokenIn];
  const balanceOut = wallet.balances?.[tokenOut];

  const isBusy = phase !== "idle";
  const blocker = swapBlocker({
    amountText,
    amountIn,
    balanceIn,
    hasPools: Boolean(pools),
    amountOut: preview?.amountOut,
    isLoopPending,
  });

  async function handleSwap() {
    if (!wallet.account || !amountIn || minAmountOut === undefined) return;
    const submittedPool = POOL_ADDRESS[pool];
    const txHash = await swap({
      account: wallet.account,
      pool: submittedPool,
      tokenIn: input.address,
      amountIn,
      minAmountOut,
    });
    if (!txHash) return;
    wallet.refetch();
    onSwapped({ txHash, pool: submittedPool });
  }

  return (
    <div className="panel">
      {/* Locked while a swap is in flight, so the panel always shows the trade being signed. */}
      <fieldset disabled={isBusy} className={styles.fieldset}>
        <legend className="sr-only">Swap</legend>
        <div className="panel-head">
          <span className="label" aria-hidden="true">
            [ Swap ]
          </span>
          <div role="group" aria-label="Pool" className={styles.toggle}>
            {POOL_KEYS.map((key) => (
              <button key={key} type="button" aria-pressed={pool === key} onClick={() => setPool(key)}>
                Pool {key}
              </button>
            ))}
          </div>
        </div>
        <p className="panel-row small muted">
          There are two pools selling the same token. Pick one to swap on. Your swap moves its price away from the
          other pool, and that difference is what sets things off.
        </p>

        <div className={`panel-row ${styles.form}`}>
          <div className={styles.field}>
            <div className={`small muted ${styles.fieldHead}`}>
              <label htmlFor="swap-amount">You pay</label>
              <span className="num">Balance {formatBalance(balanceIn, input)}</span>
            </div>
            <div className={`${styles.inputBox} ${styles.editable}`}>
              <input
                id="swap-amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={amountText}
                onChange={(event) => setAmountText(event.target.value)}
                aria-invalid={amountText !== "" && amountIn === null}
                aria-describedby={blocker ? "swap-blocker" : undefined}
              />
              <span className={styles.symbol}>{input.symbol}</span>
            </div>
          </div>

          <div className={styles.switchRow}>
            <button
              type="button"
              className={styles.switch}
              aria-label={`Switch direction: pay ${output.symbol}, receive ${input.symbol}`}
              onClick={() => {
                setTokenIn(tokenOut);
                setAmountText("");
              }}
            >
              ↓
            </button>
          </div>

          <div className={styles.field}>
            <div className={`small muted ${styles.fieldHead}`}>
              <span id="swap-receive-label">You get, roughly</span>
              <span className="num">Balance {formatBalance(balanceOut, output)}</span>
            </div>
            <div className={styles.inputBox}>
              <output htmlFor="swap-amount" aria-labelledby="swap-receive-label" aria-live="off">
                {preview ? formatAmount(preview.amountOut, output.decimals, output.display) : "—"}
              </output>
              <span className={styles.symbol}>{output.symbol}</span>
            </div>
          </div>
        </div>
      </fieldset>

      {preview ? (
        <p className={`panel-row ${styles.verdict} ${preview.willRequestCallback ? "active" : ""}`}>
          <strong>{preview.willRequestCallback ? "Big enough to set off a trade." : "Too small to set off a trade."}</strong>
          <span className="small muted">
            {preview.willRequestCallback
              ? `After your swap the two pools will be ${apartLabel(preview.gapBps)} apart. That should be enough for the contract to step in.`
              : `After your swap the two pools will be only ${apartLabel(preview.gapBps)} apart. Trading that would not cover the fees, so nothing will follow. Try a larger amount.`}
          </span>
        </p>
      ) : null}

      <details className={styles.details}>
        <summary>Details</summary>
        <dl className={styles.summary}>
          <SummaryRow
            term="You get at least"
            value={minAmountOut === undefined ? "—" : `${formatAmount(minAmountOut, output.decimals, output.display)} ${output.symbol}`}
          />
          <SummaryRow
            term={`Price on Pool ${pool} after your swap`}
            value={preview ? `${formatAmount(preview.priceAfter, USDC_DECIMALS, 2)} USDC` : "—"}
          />
          <SummaryRow
            term={`Difference from Pool ${otherPool(pool)}`}
            value={preview ? formatPercent(preview.gapBps) : "—"}
          />
          <SummaryRow term="Pool fee" value={`${(Number(POOL_FEE_BPS) / 100).toFixed(2)}%`} />
          <SummaryRow term="Price movement allowed" value={`${Number(SLIPPAGE_BPS) / 100}%`} />
        </dl>
      </details>

      <div className={`panel-row ${styles.action}`}>
        {!wallet.account || wallet.isWrongNetwork ? (
          <WalletButton block />
        ) : (
          <>
            <button type="button" className="btn primary block" disabled={Boolean(blocker) || isBusy} onClick={handleSwap}>
              {isBusy
                ? PHASE_LABEL[phase]
                : amountIn && !blocker
                  ? `Swap ${formatAmount(amountIn, input.decimals, input.display)} ${input.symbol} on Pool ${pool}`
                  : "Swap"}
            </button>
            {blocker && !isBusy ? (
              <p id="swap-blocker" className="small muted">
                {blocker}
              </p>
            ) : null}
            {!blocker && !isBusy ? (
              <p className="small faint">
                First time? Your wallet will ask twice: once to allow this exact amount, then to swap.
              </p>
            ) : null}
          </>
        )}
        {error ? (
          <p role="alert" className="small danger">
            {error}
          </p>
        ) : null}
      </div>

      <FaucetRow wallet={wallet} />
    </div>
  );
}

/** Size of a price difference without a sign, e.g. "11.05%". */
function apartLabel(gapBps: number): string {
  return `${(Math.abs(gapBps) / 100).toFixed(2)}%`;
}

function formatBalance(balance: bigint | undefined, token: { decimals: number; display: number }): string {
  return balance === undefined ? "—" : formatAmount(balance, token.decimals, token.display);
}

interface BlockerInput {
  amountText: string;
  amountIn: bigint | null;
  balanceIn: bigint | undefined;
  amountOut: bigint | undefined;
  hasPools: boolean;
  isLoopPending: boolean;
}

/** Why the swap cannot be submitted, as a sentence shown under the button. */
function swapBlocker({ amountText, amountIn, balanceIn, amountOut, hasPools, isLoopPending }: BlockerInput): string | undefined {
  if (!hasPools) return "Loading prices…";
  if (isLoopPending) return "Your last swap is still playing out on the right. Wait for it to finish before swapping again.";
  if (amountText.trim() === "") return "Enter an amount.";
  if (amountIn === null) return "Enter a valid amount, for example 3,000 or 0.5.";
  if (amountIn === 0n || amountOut === 0n) return "Enter an amount large enough to receive something.";
  if (balanceIn !== undefined && amountIn > balanceIn) return "You do not have enough for this amount. Get test tokens below.";
  return undefined;
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
