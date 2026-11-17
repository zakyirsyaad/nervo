import type { Address } from "viem";
import { HashLink } from "@/components/HashLink";
import { USDC_DECIMALS, WETH_DECIMALS } from "@/config/contracts";
import type { TokenSymbol } from "@/lib/amm";
import { formatAgo, formatAmount, formatCompact, formatSeconds, shortHex } from "@/lib/format";
import { sameAddress, type ActivityEntry, type ArbitrageEntry, type ResetEntry, type SwapEntry, type TokenAmount } from "./history";
import styles from "./history.module.css";

interface ActivityListProps {
  entries: readonly ActivityEntry[];
  account: Address | undefined;
  /** Clock of the last read, in seconds, so every "ago" is measured from the same moment. */
  nowSeconds: number;
}

const TOKEN_LABEL: Record<TokenSymbol, string> = { weth: "WETH", usdc: "USDC" };

function formatToken({ token, amount }: TokenAmount): string {
  const text = token === "weth" ? formatCompact(amount, WETH_DECIMALS, 4) : formatCompact(amount, USDC_DECIMALS, 2);
  return `${text} ${TOKEN_LABEL[token]}`;
}

function usdc(amount: bigint): string {
  return formatToken({ token: "usdc", amount });
}

export function ActivityList({ entries, account, nowSeconds }: ActivityListProps) {
  return (
    <ol className={styles.activity}>
      {entries.map((entry) => (
        <li key={entry.key} className={`${styles.activityRow} ${entry.kind === "arbitrage" ? styles.activityTrade : ""}`}>
          <div className={styles.activityText}>
            <EntryText entry={entry} account={account} />
          </div>
          <div className={styles.activityAside}>
            {entry.timestamp !== undefined ? <span className="small faint">{formatAgo(entry.timestamp, nowSeconds)}</span> : null}
            <HashLink chain="base" hash={entry.txHash} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function EntryText({ entry, account }: { entry: ActivityEntry; account: Address | undefined }) {
  if (entry.kind === "arbitrage") return <TradeText entry={entry} />;
  if (entry.kind === "swap") return <SwapText entry={entry} account={account} />;
  return <ResetText entry={entry} />;
}

function TradeText({ entry }: { entry: ArbitrageEntry }) {
  const profit = entry.profit >= 0n ? `+${usdc(entry.profit)}` : `-${usdc(-entry.profit)}`;
  const timing = entry.sincePreviousMs === undefined ? null : `${formatSeconds(entry.sincePreviousMs)} after the change before it`;
  return (
    <>
      <span className={styles.activityTitle}>The contract closed the gap</span>
      <span className="small muted">
        Bought {formatToken({ token: "weth", amount: entry.weth })} on Pool {entry.buyPool} for {usdc(entry.usdcIn)} and sold it on Pool{" "}
        {entry.sellPool} for {usdc(entry.usdcOut)}.
      </span>
      <span className="small">
        <span className="ok num">{profit} kept</span>
        {timing ? <span className="faint"> · {timing}</span> : null}
      </span>
    </>
  );
}

function SwapText({ entry, account }: { entry: SwapEntry; account: Address | undefined }) {
  const isYou = sameAddress(entry.actor, account);
  return (
    <>
      <span className={styles.activityTitle}>
        {isYou ? "You" : <span className="mono">{shortHex(entry.actor)}</span>} swapped on Pool {entry.pool}
      </span>
      <span className="small muted">
        Paid {formatToken(entry.paid)}, got {formatToken(entry.received)}.
      </span>
    </>
  );
}

function ResetText({ entry }: { entry: ResetEntry }) {
  const prices = entry.pools.map((pool) => entry.prices[pool]).filter((price): price is bigint => price !== undefined);
  const samePrice = prices.length > 1 && prices.every((price) => price === prices[0]);
  const title = entry.pools.length > 1 ? "Both pools were reset by their owner" : `Pool ${entry.pools[0]} was reset by its owner`;
  const detail = samePrice
    ? `Both set to ${formatAmount(prices[0], USDC_DECIMALS, 2)} USDC per WETH.`
    : entry.pools.map((pool) => `Pool ${pool} set to ${formatAmount(entry.prices[pool] ?? 0n, USDC_DECIMALS, 2)} USDC per WETH.`).join(" ");
  return (
    <>
      <span className={styles.activityTitle}>{title}</span>
      <span className="small muted">{detail}</span>
    </>
  );
}
