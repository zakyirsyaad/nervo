import { toEventSelector, toHex, type Address, type Hex } from "viem";
import { DECISIONS, executorAbi, OUTCOMES, reactiveAbi, type Decision, type Outcome } from "@/config/abis";
import { originChain } from "@/config/chains";
import { ADDRESSES } from "@/config/contracts";
import { opportunityId } from "@/lib/opportunity";
import { baseClient, lasnaClient } from "./clients";
import { blockTimestampMs, findTriggerLog } from "./loop";

const RESERVE_UPDATE_TOPIC = toEventSelector("ReserveUpdate(address,uint256,uint256,uint256,uint256)");
const POLL_INTERVAL_MS = 1_000;
// The decision normally lands within a second or two; look a little behind in case it beat us.
const LASNA_LOOKBACK_BLOCKS = 50n;

export const DECISION_TIMEOUT_MS = 60_000;
export const OUTCOME_TIMEOUT_MS = 60_000;

export interface Trigger {
  readonly txHash: Hex;
  readonly opportunityId: Hex;
  readonly blockNumber: bigint;
  readonly timestampMs: number;
  readonly lasnaFromBlock: bigint;
}

/** Upper block bounds. Live tracking reads to the chain head; tests replay a closed range. */
export interface BlockWindow {
  readonly lasnaToBlock?: bigint;
  readonly baseToBlock?: bigint;
}

export interface DecisionRecord {
  readonly decision: Decision;
  readonly txHash: Hex;
  readonly blockNumber: bigint;
  readonly quotedOut: bigint;
}

export interface OutcomeRecord {
  readonly outcome: Outcome;
  readonly txHash: Hex;
  readonly blockNumber: bigint;
  readonly amountIn: bigint;
  readonly actualOut: bigint;
  readonly latencyMs: number;
}

async function fetchBlockTimestampMs(blockNumber: bigint): Promise<number> {
  const block = await baseClient.request({ method: "eth_getBlockByNumber", params: [toHex(blockNumber), false] });
  const timestampMs = blockTimestampMs(block);
  if (timestampMs === null) throw new Error(`Block ${blockNumber} has no readable timestamp`);
  return timestampMs;
}

/** Resolves the swap transaction into the log ArbReactive will react to. */
export async function fetchTrigger(txHash: Hex, pool: Address): Promise<Trigger> {
  const [receipt, lasnaBlock] = await Promise.all([
    baseClient.getTransactionReceipt({ hash: txHash }),
    lasnaClient.getBlockNumber(),
  ]);
  const logIndex = findTriggerLog(receipt.logs, pool, RESERVE_UPDATE_TOPIC);
  if (logIndex === null) throw new Error("The swap emitted no ReserveUpdate event");

  return {
    txHash,
    opportunityId: opportunityId({ chainId: originChain.id, pool, txHash, logIndex }),
    blockNumber: receipt.blockNumber,
    timestampMs: await fetchBlockTimestampMs(receipt.blockNumber),
    lasnaFromBlock: lasnaBlock > LASNA_LOOKBACK_BLOCKS ? lasnaBlock - LASNA_LOOKBACK_BLOCKS : 0n,
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const handleAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

/** Calls `attempt` once a second until it returns a value. Resolves null after `timeoutMs`. */
async function pollUntil<T>(attempt: () => Promise<T | null>, timeoutMs: number, signal: AbortSignal): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const found = await attempt();
    if (found !== null) return found;
    await sleep(POLL_INTERVAL_MS, signal);
  }
  // One last look, so a result that landed during the final sleep is not reported as a timeout.
  return attempt();
}

/** Waits for ArbReactive's DecisionRecorded event for this opportunity. Null means it timed out. */
export function waitForDecision(
  trigger: Trigger,
  signal: AbortSignal,
  window: BlockWindow = {},
): Promise<DecisionRecord | null> {
  return pollUntil(async () => {
    const [event] = await lasnaClient.getContractEvents({
      address: ADDRESSES.arbReactive,
      abi: reactiveAbi,
      eventName: "DecisionRecorded",
      args: { opportunityId: trigger.opportunityId },
      fromBlock: trigger.lasnaFromBlock,
      toBlock: window.lasnaToBlock ?? "latest",
    });
    const decision = event ? DECISIONS[event.args.decision ?? -1] : undefined;
    if (!event || !decision) return null;
    return {
      decision,
      txHash: event.transactionHash,
      blockNumber: event.blockNumber,
      quotedOut: event.args.quotedOut ?? 0n,
    };
  }, DECISION_TIMEOUT_MS, signal);
}

/** Waits for ArbExecutor's ArbOutcome event for this opportunity. Null means it timed out. */
export function waitForOutcome(
  trigger: Trigger,
  signal: AbortSignal,
  window: BlockWindow = {},
): Promise<OutcomeRecord | null> {
  return pollUntil(async () => {
    const [event] = await baseClient.getContractEvents({
      address: ADDRESSES.arbExecutor,
      abi: executorAbi,
      eventName: "ArbOutcome",
      args: { opportunityId: trigger.opportunityId },
      fromBlock: trigger.blockNumber,
      toBlock: window.baseToBlock ?? "latest",
    });
    const outcome = event ? OUTCOMES[event.args.outcome ?? -1] : undefined;
    if (!event || !outcome) return null;
    return {
      outcome,
      txHash: event.transactionHash,
      blockNumber: event.blockNumber,
      amountIn: event.args.amountIn ?? 0n,
      actualOut: event.args.actualOut ?? 0n,
      latencyMs: (await fetchBlockTimestampMs(event.blockNumber)) - trigger.timestampMs,
    };
  }, OUTCOME_TIMEOUT_MS, signal);
}
