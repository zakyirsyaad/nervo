// Bounded block ranges for eth_getLogs. Public RPCs cap the range per request (Unichain Sepolia: 1,000 blocks,
// Lasna: 30,000), so every scan is split into pieces and never reaches further back than a fixed look-back.

export interface BlockRange {
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
}

/** Splits [fromBlock, toBlock] into consecutive pieces of at most `maxBlocks` blocks, oldest first. */
export function splitRange(fromBlock: bigint, toBlock: bigint, maxBlocks: bigint): BlockRange[] {
  if (maxBlocks < 1n) throw new RangeError("maxBlocks must be at least 1");
  if (fromBlock > toBlock) return [];
  const count = Number((toBlock - fromBlock) / maxBlocks) + 1;
  return Array.from({ length: count }, (_, index) => {
    const start = fromBlock + BigInt(index) * maxBlocks;
    const end = start + maxBlocks - 1n;
    return { fromBlock: start, toBlock: end < toBlock ? end : toBlock };
  });
}

/** First block of a `lookback`-block window that ends at `head`, never before `floor` or block 0. */
export function lookbackStart(head: bigint, lookback: bigint, floor = 0n): bigint {
  const start = head >= lookback ? head - lookback + 1n : 0n;
  return start > floor ? start : floor;
}

/** Where an incremental scan resumes: right after `scannedTo`, unless that is older than the window. */
export function nextScanStart(scannedTo: bigint | undefined, windowStart: bigint): bigint {
  if (scannedTo === undefined || scannedTo + 1n < windowStart) return windowStart;
  return scannedTo + 1n;
}

export interface StartEstimateInput {
  readonly head: bigint;
  readonly headTimestamp: bigint;
  /** Time, in seconds, of the event whose follow-ups we are looking for. */
  readonly sinceTimestamp: bigint;
  /** Extra blocks for clock differences between chains. */
  readonly margin: bigint;
  readonly maxLookback: bigint;
}

export interface StartEstimate {
  readonly fromBlock: bigint;
  /** True when the cap cut the window short, so older records were not read. */
  readonly isPartial: boolean;
}

/**
 * First block worth reading on a chain whose blocks are at least one second apart: going back one block per
 * elapsed second always reaches far enough, and the cap keeps the scan bounded.
 */
export function estimateStartBlock({ head, headTimestamp, sinceTimestamp, margin, maxLookback }: StartEstimateInput): StartEstimate {
  const elapsed = headTimestamp > sinceTimestamp ? headTimestamp - sinceTimestamp : 0n;
  const wanted = elapsed + margin;
  const isPartial = wanted > maxLookback;
  const back = isPartial ? maxLookback : wanted;
  return { fromBlock: head > back ? head - back : 0n, isPartial };
}
