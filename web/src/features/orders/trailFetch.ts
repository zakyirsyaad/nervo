import { formatLog, getAbiItem, numberToHex, parseEventLogs, toEventSelector, type Hex, type Log } from "viem";
import { MIRROR_REASONS, MIRROR_STATES, ORDER_OUTCOMES, orderBookAbi, orderReactiveAbi } from "@/config/orderAbis";
import { ORDER_STACK } from "@/config/orders";
import { estimateStartBlock, splitRange, type BlockRange } from "@/lib/blockRange";
import { mapLimited } from "@/lib/concurrency";
import {
  LASNA_LOG_BLOCKS,
  LASNA_SCAN_CONCURRENCY,
  lasnaClient,
  UNICHAIN_LOG_BLOCKS,
  UNICHAIN_SCAN_CONCURRENCY,
  unichainClient,
} from "./clients";
import { toOrderView, type OrderRef, type OrderView } from "./orderList";
import { readOrderDetails } from "./scan";
import { appendTrail, EMPTY_TRAIL, type OrderTrail } from "./trail";

/** Lasna history read for one order: 7 days and a few hours at one block per second, the longest an order lives. */
const LASNA_TRAIL_LOOKBACK = 620_000n;
/** Extra Lasna blocks, for clock differences between Unichain and Lasna. */
const LASNA_MARGIN_BLOCKS = 120n;
/** Unichain history read for one order's outcomes: about 14 hours. */
const UNICHAIN_TRAIL_LOOKBACK = 50_000n;
/** Reactive normally mirrors an order within seconds; after this the tracker stops and offers to keep waiting. */
export const MIRROR_TIMEOUT_MS = 60_000;

const TOPIC = {
  mirrored: toEventSelector(getAbiItem({ abi: orderReactiveAbi, name: "OrderMirrored" })),
  triggered: toEventSelector(getAbiItem({ abi: orderReactiveAbi, name: "OrderTriggered" })),
  outcome: toEventSelector(getAbiItem({ abi: orderBookAbi, name: "OrderOutcome" })),
  cancelled: toEventSelector(getAbiItem({ abi: orderBookAbi, name: "OrderCancelled" })),
} as const;

/** Everything known about one order, plus where the next incremental read starts on each chain. */
export interface TrailSnapshot {
  readonly trail: OrderTrail;
  /** The order as the order book holds it now, judged against Unichain's clock. */
  readonly order: OrderView;
  readonly lasnaNext: bigint;
  readonly unichainNext: bigint;
  /** The order is older than the Lasna history read, so its first records may be missing. */
  readonly isLasnaPartial: boolean;
  /** The order is older than the Unichain history read, so its earlier outcomes may be missing. */
  readonly isUnichainPartial: boolean;
  readonly startedAtMs: number;
  readonly hasMirrorTimedOut: boolean;
}

/**
 * Closed block ranges to read instead of placement-to-head. Live tracking leaves it out; tests replay an order
 * older than the look-back windows with it.
 */
export interface TrailWindow {
  readonly lasna: BlockRange;
  readonly unichainToBlock: bigint;
}

interface Head {
  readonly number: bigint;
  readonly timestamp: bigint;
}

interface Cursors {
  readonly lasnaNext: bigint;
  readonly unichainNext: bigint;
  readonly isLasnaPartial: boolean;
  readonly isUnichainPartial: boolean;
}

interface Positioned {
  readonly txHash: Hex;
  readonly blockNumber: bigint;
  readonly logIndex: number;
}

function positionOf(log: Log): Positioned | undefined {
  if (log.transactionHash === null || log.blockNumber === null || log.logIndex === null) return undefined;
  return { txHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex };
}

/** One eth_getLogs for any of `topics0` emitted by `address` for this order id (always the first indexed field). */
async function orderLogs(client: typeof lasnaClient | typeof unichainClient, address: Hex, topics0: Hex[], orderId: bigint, range: BlockRange): Promise<Log[]> {
  const raw = await client.request({
    method: "eth_getLogs",
    params: [
      {
        address,
        topics: [topics0, numberToHex(orderId, { size: 32 })],
        fromBlock: numberToHex(range.fromBlock),
        toBlock: numberToHex(range.toBlock),
      },
    ],
  });
  return raw.map((log) => formatLog(log));
}

async function scanLasna(orderId: bigint, fromBlock: bigint, toBlock: bigint): Promise<Partial<OrderTrail>> {
  const ranges = splitRange(fromBlock, toBlock, LASNA_LOG_BLOCKS);
  const pages = await mapLimited(ranges, LASNA_SCAN_CONCURRENCY, (range) =>
    orderLogs(lasnaClient, ORDER_STACK.orderReactive, [TOPIC.mirrored, TOPIC.triggered], orderId, range),
  );
  const logs = parseEventLogs({ abi: orderReactiveAbi, logs: pages.flat() });
  return {
    mirrors: logs.flatMap((log) => {
      const position = positionOf(log);
      if (log.eventName !== "OrderMirrored" || !position) return [];
      const state = MIRROR_STATES[log.args.state];
      const reason = MIRROR_REASONS[log.args.reason];
      return state && reason ? [{ ...position, state, reason }] : [];
    }),
    triggers: logs.flatMap((log) => {
      const position = positionOf(log);
      if (log.eventName !== "OrderTriggered" || !position) return [];
      const { price, sourceTimestamp, afterTimeout } = log.args;
      return [{ ...position, price, sourceTimestamp, afterTimeout }];
    }),
  };
}

async function scanUnichain(orderId: bigint, fromBlock: bigint, toBlock: bigint): Promise<Partial<OrderTrail>> {
  const ranges = splitRange(fromBlock, toBlock, UNICHAIN_LOG_BLOCKS);
  const pages = await mapLimited(ranges, UNICHAIN_SCAN_CONCURRENCY, (range) =>
    orderLogs(unichainClient, ORDER_STACK.orderBook, [TOPIC.outcome, TOPIC.cancelled], orderId, range),
  );
  const logs = parseEventLogs({ abi: orderBookAbi, logs: pages.flat() });
  return {
    outcomes: logs.flatMap((log) => {
      const position = positionOf(log);
      if (log.eventName !== "OrderOutcome" || !position) return [];
      const outcome = ORDER_OUTCOMES[log.args.outcome];
      const { amountOut, observedPrice, sourceTimestamp, timestamp } = log.args;
      return outcome ? [{ ...position, outcome, amountOut, observedPrice, sourceTimestamp, timestamp }] : [];
    }),
    cancels: logs.flatMap((log) => {
      const position = positionOf(log);
      return log.eventName === "OrderCancelled" && position ? [position] : [];
    }),
  };
}

/** Where to start reading for an order seen for the first time: from its placement, within bounded windows. */
async function firstCursors(ref: OrderRef, unichainHead: Head, lasnaHead: Head): Promise<Cursors> {
  const placedBlock = await unichainClient.getBlock({ blockNumber: ref.blockNumber });
  const lasnaStart = estimateStartBlock({
    head: lasnaHead.number,
    headTimestamp: lasnaHead.timestamp,
    sinceTimestamp: placedBlock.timestamp,
    margin: LASNA_MARGIN_BLOCKS,
    maxLookback: LASNA_TRAIL_LOOKBACK,
  });
  const unichainFloor = unichainHead.number > UNICHAIN_TRAIL_LOOKBACK ? unichainHead.number - UNICHAIN_TRAIL_LOOKBACK : 0n;
  const isUnichainPartial = ref.blockNumber < unichainFloor;
  return {
    lasnaNext: lasnaStart.fromBlock,
    unichainNext: isUnichainPartial ? unichainFloor : ref.blockNumber,
    isLasnaPartial: lasnaStart.isPartial,
    isUnichainPartial,
  };
}

function after(head: bigint, cursor: bigint): bigint {
  return head + 1n > cursor ? head + 1n : cursor;
}

/**
 * Reads what happened to the order since the previous snapshot: new Lasna and Unichain logs, and its current
 * status in the order book. The first call scans from the placement; later calls only read new blocks.
 */
export async function fetchTrailSnapshot(
  ref: OrderRef,
  previous: TrailSnapshot | undefined,
  window?: TrailWindow,
): Promise<TrailSnapshot> {
  const [unichainHead, lasnaHead, details] = await Promise.all([
    unichainClient.getBlock({ blockTag: "latest" }),
    lasnaClient.getBlock({ blockTag: "latest" }),
    readOrderDetails(ref.id),
  ]);
  const windowCursors: Cursors | undefined = window && {
    lasnaNext: window.lasna.fromBlock,
    unichainNext: ref.blockNumber,
    isLasnaPartial: false,
    isUnichainPartial: false,
  };
  const cursors: Cursors = previous ?? windowCursors ?? (await firstCursors(ref, unichainHead, lasnaHead));
  const lasnaTo = window?.lasna.toBlock ?? lasnaHead.number;
  const unichainTo = window?.unichainToBlock ?? unichainHead.number;
  const [lasnaFound, unichainFound] = await Promise.all([
    scanLasna(ref.id, cursors.lasnaNext, lasnaTo),
    scanUnichain(ref.id, cursors.unichainNext, unichainTo),
  ]);
  const trail = appendTrail(previous?.trail ?? EMPTY_TRAIL, { ...lasnaFound, ...unichainFound });
  const startedAtMs = previous?.startedAtMs ?? Date.now();

  return {
    trail,
    order: toOrderView(ref, details, unichainHead.timestamp, ORDER_STACK),
    lasnaNext: after(lasnaTo, cursors.lasnaNext),
    unichainNext: after(unichainTo, cursors.unichainNext),
    isLasnaPartial: cursors.isLasnaPartial,
    isUnichainPartial: cursors.isUnichainPartial,
    startedAtMs,
    hasMirrorTimedOut: trail.mirrors.length === 0 && Date.now() - startedAtMs >= MIRROR_TIMEOUT_MS,
  };
}
