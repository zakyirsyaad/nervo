"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { poolAbi } from "@/config/abis";
import { BASE_SEPOLIA_BLOCK_TIME_MS } from "@/config/chains";
import { ADDRESSES } from "@/config/contracts";
import { lookbackStart, nextScanStart, splitRange } from "@/lib/blockRange";
import { mapLimited } from "@/lib/concurrency";
import { historyClient } from "./clients";
import { mergeLogs, toPoolLog, type PoolLog } from "./history";

// About five and a half hours of Base Sepolia blocks: two requests on the first read.
const LOOKBACK_BLOCKS = 100_000n;
// The history RPC's eth_getLogs cap.
const RANGE_BLOCKS = 50_000n;
const PARALLEL_REQUESTS = 2;
// Each read starts this far back: a load-balanced RPC can answer getLogs from a node a block or two behind the
// one that gave the head. Logs read twice are merged away.
const RESCAN_OVERLAP_BLOCKS = 25n;
const POLL_INTERVAL_MS = 4_000;
const QUERY_KEY = ["pool-history"] as const;

export const HISTORY_HOURS = Math.floor((Number(LOOKBACK_BLOCKS) * BASE_SEPOLIA_BLOCK_TIME_MS) / 3_600_000);

type PoolEvent = Extract<(typeof poolAbi)[number], { type: "event" }>;

const POOL_EVENTS = poolAbi.filter((item): item is PoolEvent => item.type === "event");
const POOLS = { A: ADDRESSES.poolA, B: ADDRESSES.poolB } as const;

export interface PoolHistory {
  readonly logs: readonly PoolLog[];
  readonly scannedTo: bigint;
  /** Wall-clock time of the read, in seconds, for "2 min ago" labels. */
  readonly readAtSeconds: number;
}

async function readLogs(fromBlock: bigint, toBlock: bigint): Promise<PoolLog[]> {
  const logs = await historyClient.getLogs({ address: [POOLS.A, POOLS.B], events: POOL_EVENTS, fromBlock, toBlock });
  return logs.flatMap((log) => {
    const decoded = toPoolLog(log, POOLS, ADDRESSES.weth);
    return decoded ? [decoded] : [];
  });
}

/** Reads only the blocks added since the last read, and forgets logs that left the window. */
async function readHistory(known: PoolHistory | undefined): Promise<PoolHistory> {
  const head = await historyClient.getBlockNumber();
  const windowStart = lookbackStart(head, LOOKBACK_BLOCKS);
  const resumeAt = nextScanStart(known?.scannedTo, windowStart) - RESCAN_OVERLAP_BLOCKS;
  const ranges = splitRange(resumeAt > windowStart ? resumeAt : windowStart, head, RANGE_BLOCKS);
  const pages = await mapLimited(ranges, PARALLEL_REQUESTS, (range) => readLogs(range.fromBlock, range.toBlock));
  return {
    logs: mergeLogs(known?.logs ?? [], pages.flat(), windowStart),
    scannedTo: head,
    readAtSeconds: Math.floor(Date.now() / 1000),
  };
}

/** Swaps and reserve changes on both pools over the last few hours, kept up to date. */
export function usePoolHistory() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => readHistory(queryClient.getQueryData<PoolHistory>(QUERY_KEY)),
    refetchInterval: POLL_INTERVAL_MS,
  });
}
