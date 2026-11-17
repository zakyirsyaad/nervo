"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { orderBookAbi, ORDER_OUTCOMES } from "@/config/orderAbis";
import { ORDER_STACK } from "@/config/orders";
import { lookbackStart, nextScanStart, splitRange } from "@/lib/blockRange";
import { mapLimited } from "@/lib/concurrency";
import { UNICHAIN_LOG_BLOCKS, UNICHAIN_SCAN_CONCURRENCY, unichainClient } from "./clients";
import { buildBookRows, summarizeBook, type BookOutcome, type BookRow, type BookSummary } from "./orderBook";
import { mergeOrderRefs, type OrderRef } from "./orderList";
import { ORDER_SCAN_LOOKBACK, readOrderViews } from "./scan";

const LOG_INTERVAL_MS = 8_000;
const VIEW_INTERVAL_MS = 8_000;
// Each scan starts a few blocks back, in case the node that answered getLogs was behind the one that gave the head.
const RESCAN_OVERLAP_BLOCKS = 5n;
const LOGS_KEY = ["order-book-logs", ORDER_STACK.orderBook] as const;

type BookEvent = Extract<(typeof orderBookAbi)[number], { type: "event"; name: "OrderPlaced" | "OrderOutcome" }>;
const BOOK_EVENTS = orderBookAbi.filter(
  (item): item is BookEvent => item.type === "event" && (item.name === "OrderPlaced" || item.name === "OrderOutcome"),
);

interface BookLogs {
  readonly placed: readonly OrderRef[];
  readonly outcomes: readonly BookOutcome[];
  readonly scannedTo: bigint;
}

function sameOutcome(left: BookOutcome, right: BookOutcome): boolean {
  return left.txHash === right.txHash && left.logIndex === right.logIndex;
}

async function readBookLogs(known: BookLogs | undefined): Promise<BookLogs> {
  const head = await unichainClient.getBlockNumber({ cacheTime: 0 });
  const windowStart = lookbackStart(head, ORDER_SCAN_LOOKBACK, ORDER_STACK.orderBookDeployBlock);
  const resumeAt = nextScanStart(known?.scannedTo, windowStart) - RESCAN_OVERLAP_BLOCKS;
  const ranges = splitRange(resumeAt > windowStart ? resumeAt : windowStart, head, UNICHAIN_LOG_BLOCKS);
  const pages = await mapLimited(ranges, UNICHAIN_SCAN_CONCURRENCY, (range) =>
    unichainClient.getLogs({ address: ORDER_STACK.orderBook, events: BOOK_EVENTS, fromBlock: range.fromBlock, toBlock: range.toBlock }),
  );

  const placed: OrderRef[] = [];
  const outcomes: BookOutcome[] = [];
  for (const log of pages.flat()) {
    if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) continue;
    if (log.eventName === "OrderPlaced" && log.args.orderId !== undefined) {
      placed.push({ id: log.args.orderId, txHash: log.transactionHash, blockNumber: log.blockNumber });
    }
    if (log.eventName === "OrderOutcome") {
      const { orderId, outcome, amountOut, observedPrice, sourceTimestamp, timestamp } = log.args;
      const name = outcome === undefined ? undefined : ORDER_OUTCOMES[outcome];
      if (orderId === undefined || !name || amountOut === undefined || observedPrice === undefined) continue;
      if (sourceTimestamp === undefined || timestamp === undefined) continue;
      outcomes.push({
        orderId,
        outcome: name,
        amountOut,
        observedPrice,
        sourceTimestamp,
        timestamp,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
      });
    }
  }

  // Drop what left the window, so a tab left open does not keep every log it ever read.
  const keptOutcomes = (known?.outcomes ?? []).filter(
    (old) => old.blockNumber >= windowStart && !outcomes.some((fresh) => sameOutcome(old, fresh)),
  );
  const keptPlaced = (known?.placed ?? []).filter((ref) => ref.blockNumber >= windowStart);
  return {
    placed: mergeOrderRefs(placed, keptPlaced),
    outcomes: [...keptOutcomes, ...outcomes],
    scannedTo: head,
  };
}

export interface OrderBook {
  readonly rows: readonly BookRow[];
  readonly outcomes: readonly BookOutcome[];
  readonly summary: BookSummary;
  /** Orders placed in the window, newest first, before their state is read. */
  readonly refs: readonly OrderRef[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly retry: () => void;
}

/** Every order placed in the last ORDER_SCAN_LOOKBACK blocks, by anyone, with its outcome. Needs no wallet. */
export function useOrderBook(isDeployed: boolean): OrderBook {
  const queryClient = useQueryClient();
  const logs = useQuery({
    queryKey: LOGS_KEY,
    queryFn: () => readBookLogs(queryClient.getQueryData<BookLogs>(LOGS_KEY)),
    enabled: isDeployed,
    refetchInterval: LOG_INTERVAL_MS,
  });

  // Every order placed in the window: one multicall reads them all, so the list and its counts cover the whole window.
  const refs = logs.data?.placed ?? [];
  const views = useQuery({
    queryKey: ["order-book-views", ORDER_STACK.orderBook, refs.map((ref) => ref.id.toString()).join(",")],
    queryFn: () => readOrderViews(refs),
    enabled: refs.length > 0,
    refetchInterval: VIEW_INTERVAL_MS,
    placeholderData: keepPreviousData,
  });

  const outcomes = logs.data?.outcomes ?? [];
  const rows = buildBookRows(views.data ?? [], outcomes);
  return {
    rows,
    outcomes,
    summary: summarizeBook(rows),
    refs,
    // A disabled query stays pending forever; without the order stack there is nothing to load.
    isLoading: isDeployed && (logs.isPending || (refs.length > 0 && views.isPending)),
    isError: logs.isError || views.isError,
    retry: () => {
      void logs.refetch();
      void views.refetch();
    },
  };
}
