import { MAX_WATCHED_PER_OWNER } from "@/config/orders";

export type Deployment = "checking" | "deployed" | "missing" | "error";

export interface DraftCheck {
  readonly deployment: Deployment;
  readonly hasPrices: boolean;
  /** Orders the Reactive contract watches for this wallet, when known. */
  readonly watchedCount: number | undefined;
  readonly amountText: string;
  readonly amountIn: bigint | null;
  readonly minimum: bigint;
  /** The minimum with its unit, e.g. "0.001 WETH". */
  readonly minimumLabel: string;
  /** A valid amount to suggest, e.g. "0.5". */
  readonly example: string;
  readonly balance: bigint | undefined;
  readonly triggerPrice: bigint | null;
  readonly minAmountOut: bigint | null;
  readonly orderFee: bigint | undefined;
  readonly ethBalance: bigint | undefined;
}

const DEPLOYMENT_BLOCKER: Record<Exclude<Deployment, "deployed">, string> = {
  checking: "Checking the order contracts…",
  missing: "The order contracts are not deployed on Unichain Sepolia yet. Check back soon.",
  error: "Cannot reach Unichain Sepolia right now. Try again in a moment.",
};

/** Why the order cannot be placed yet, as one sentence shown under the button. */
export function orderBlocker(check: DraftCheck): string | undefined {
  if (check.deployment !== "deployed") return DEPLOYMENT_BLOCKER[check.deployment];
  if (!check.hasPrices) return "Loading prices…";
  if (check.watchedCount !== undefined && check.watchedCount >= MAX_WATCHED_PER_OWNER) {
    return `You already have ${MAX_WATCHED_PER_OWNER} orders being watched, the most per wallet. Cancel one to place another.`;
  }
  return amountBlocker(check) ?? priceBlocker(check) ?? feeBlocker(check);
}

function amountBlocker({ amountText, amountIn, minimum, minimumLabel, example, balance }: DraftCheck): string | undefined {
  if (amountText.trim() === "") return "Enter an amount.";
  if (amountIn === null) return `Enter a valid amount, for example ${example}.`;
  if (amountIn < minimum) return `The smallest order is ${minimumLabel}.`;
  if (balance !== undefined && amountIn > balance) {
    return "You do not have enough for this amount on Unichain. Get test tokens below.";
  }
  return undefined;
}

function priceBlocker({ triggerPrice, minAmountOut }: DraftCheck): string | undefined {
  if (triggerPrice === null || triggerPrice === 0n) return "Enter a trigger price above zero.";
  if (minAmountOut === null || minAmountOut === 0n) return "Enter how much you want to receive at least, above zero.";
  return undefined;
}

function feeBlocker({ orderFee, ethBalance }: DraftCheck): string | undefined {
  if (orderFee === undefined) return "Reading the trigger fee…";
  if (ethBalance !== undefined && ethBalance <= orderFee) {
    return "You need a little Unichain Sepolia ETH for the trigger fee and network fees. Get some with the link below.";
  }
  return undefined;
}
