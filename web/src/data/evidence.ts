import compareJson from "./compare.json";
import latencyJson from "./latency.json";

export interface LatencySample {
  readonly originTx: string;
  readonly lasnaTx: string;
  readonly callbackTx: string;
  readonly originBlock: number;
  readonly lasnaBlock: number;
  readonly callbackBlock: number;
  readonly outcome: string;
  readonly latencyMs: number;
}

export interface StackResult {
  readonly logs: number;
  readonly callbacks: number;
  readonly executed: number;
  readonly wasted: number;
  readonly ethSpent: number;
  readonly lreactSpent: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
}

export const LATENCY_SAMPLES: readonly LatencySample[] = latencyJson.samples;
export const LATENCIES_MS: readonly number[] = LATENCY_SAMPLES.map((sample) => sample.latencyMs);
export const CALLBACKS_REQUESTED: number = latencyJson.requested;
export const CALLBACKS_ARRIVED: number = latencyJson.arrived;
export const CALLBACK_TIMEOUTS: number = latencyJson.timeouts;

export const COMPARE_STEPS: number = compareJson.steps;
export const FILTERED: StackResult = compareJson.filtered;
export const UNFILTERED: StackResult = compareJson.unfiltered;

/** Share of destination ETH the Lasna filter saved, as a whole percentage. */
export const ETH_SAVED_PERCENT: number = Math.round((1 - FILTERED.ethSpent / UNFILTERED.ethSpent) * 100);

export const BLOCK_INTERVAL_MS = 200;

export interface Scenario {
  readonly name: string;
  readonly triggerTx: string;
  readonly decision: string;
  readonly decisionTx: string;
  readonly outcome?: string;
  readonly callbackTx?: string;
  readonly latencyMs?: number;
}

// Hashes from README.md, "Bukti on-chain".
export const SCENARIOS: readonly Scenario[] = [
  {
    name: "The trade is made",
    triggerTx: "0x5be4c13e8e82050dabd132dcd60fd3e75b2803c409958a87f03175eacf0a3a46",
    decision: "CallbackRequested",
    decisionTx: "0x695e4bf7030e53b168592b7c5c9ab8bee2058fee28e6846d8ef4fce30e9a3a15",
    outcome: "Executed",
    callbackTx: "0xe34f0e6d3be968c3a320f8fe64be21c96251c5c3519d6f5bd60ce1756375be88",
    latencyMs: 1800,
  },
  {
    name: "Prices move back first, so the trade is cancelled",
    triggerTx: "0x4db64309a8f23a16dca81249f51a9cea6b8cb90a80c3c7160d5cb2fcf9c76290",
    decision: "CallbackRequested",
    decisionTx: "0x6b8ff7ea2a81af09dd6f8eaad8c1a29aa9a1f23afe9130a5a9ddc701a7efde97",
    outcome: "SkippedMarginGone",
    callbackTx: "0xc0806ffd315879e0351d8c8395155ab746c4fbd765fef4d8d121d8db7ff3642b",
    latencyMs: 1200,
  },
  {
    name: "The gap is too small, so nothing is sent",
    triggerTx: "0xe8b48f477311a7ab0b2815ff8e480eb68da96ba366e01ea1e9dc01cdf1eb0b36",
    decision: "MarginBelowThreshold",
    decisionTx: "0x2b13cbcd716892aae76d14bb1c124a321ae604d81dffcd7af4c1a5d55ee441aa",
  },
];

// Mainnet replay, from replay/data/summary.json (1,000 USDC input, 0.10 USDC threshold).
export const REPLAY = {
  episodes: 538,
  closedSameBlock: 514,
  viableAfter: [
    { delaySeconds: 1, count: 2 },
    { delaySeconds: 2, count: 0 },
    { delaySeconds: 5, count: 4 },
  ],
} as const;
