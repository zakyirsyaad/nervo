export interface HistogramBucket {
  readonly value: number;
  readonly count: number;
}

/** Nearest-rank percentile, the same method as tools/latency_report.py. */
export function percentile(samples: readonly number[], rank: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil((rank / 100) * sorted.length) - 1);
  return sorted[index];
}

/** Counts samples per bucket from the smallest to the largest value, keeping empty buckets. */
export function histogram(samples: readonly number[], bucketSize: number): HistogramBucket[] {
  if (samples.length === 0) return [];
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const bucketCount = Math.round((max - min) / bucketSize) + 1;
  return Array.from({ length: bucketCount }, (_, index) => {
    const value = min + index * bucketSize;
    return { value, count: samples.filter((sample) => sample === value).length };
  });
}
