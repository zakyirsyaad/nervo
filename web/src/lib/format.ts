// Plain digits or correctly grouped thousands, with an optional fraction. "1,5" is rejected, not read as 15.
const AMOUNT_PATTERN = /^(\d{1,3}(,\d{3})+|\d*)(\.\d*)?$/;

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Formats base units for display. Truncates, never rounds up. */
export function formatAmount(value: bigint, decimals: number, displayDecimals: number): string {
  const unit = 10n ** BigInt(decimals);
  const whole = groupThousands((value / unit).toString());
  if (displayDecimals === 0) return whole;
  const fraction = (value % unit).toString().padStart(decimals, "0").slice(0, displayDecimals);
  return `${whole}.${fraction.padEnd(displayDecimals, "0")}`;
}

/** Like formatAmount, without trailing zeros: 0.0010 -> "0.001", 1.00 -> "1". */
export function formatCompact(value: bigint, decimals: number, maxDecimals: number): string {
  return formatAmount(value, decimals, maxDecimals).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/** Parses user input into base units. Returns null when the text is not a valid amount. */
export function parseAmount(text: string, decimals: number): bigint | null {
  const trimmed = text.trim();
  if (!AMOUNT_PATTERN.test(trimmed) || !/\d/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.replace(/,/g, "").split(".");
  if (fraction.length > decimals) return null;
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

export const PENDING_TEXT = { loading: "Loading…", unavailable: "Unavailable", readingBalance: "Reading balance…" } as const;

interface BalanceTextInput {
  balance: bigint | undefined;
  decimals: number;
  displayDecimals: number;
  isConnected: boolean;
  /** Words before the amount, e.g. "Balance" or "On Unichain:". */
  prefix: string;
}

/** Balance beside a form field. Undefined until a wallet is connected, since there is no balance to show. */
export function balanceText({ balance, decimals, displayDecimals, isConnected, prefix }: BalanceTextInput): string | undefined {
  if (!isConnected) return undefined;
  if (balance === undefined) return PENDING_TEXT.readingBalance;
  return `${prefix} ${formatAmount(balance, decimals, displayDecimals)}`;
}

export function shortHex(hex: string): string {
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}

export function formatMs(ms: number): string {
  return `${groupThousands(Math.round(ms).toString())} ms`;
}

export function formatBps(bps: number): string {
  return `${bps > 0 ? "+" : ""}${bps} bps`;
}

/** Basis points as a signed percentage, e.g. 775 -> "+7.75%". */
export function formatPercent(bps: number): string {
  return `${bps > 0 ? "+" : ""}${(bps / 100).toFixed(2)}%`;
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} seconds`;
}

/** Whole seconds in words, e.g. 4 -> "4 seconds". Zero means both blocks carry the same second. */
export function formatWholeSeconds(seconds: number): string {
  if (seconds < 1) return "under 1 second";
  if (seconds === 1) return "1 second";
  return `${groupThousands(String(Math.round(seconds)))} seconds`;
}
