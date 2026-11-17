# WETH/USDC market replay on Base mainnet

Answers the market validation question: how many arbitrage episodes between two real pools are still viable 1, 2 and 5 seconds after the signal.

## Results

Window from 11 November 2026 00:00 WIB (UTC+7) to 14 November 2026 00:00 WIB (blocks 55,698,122–56,994,121, 72 hours, 200 ms blocks). The price moved from 2,017.57 to 1,926.85 USDC/WETH. There were 134,365 swaps (75,831 Aerodrome Slipstream, 58,534 Uniswap V3 0.05%) and 127,460 evaluation points.

**Almost every gap is closed in the same block, and none lasts longer than 1 second.**

Input 1,000 USDC:

| Surplus threshold | Episodes | Closed in the same block | Lasted 1 block (200 ms) | Lasted up to 1 s | Lasted > 1 s | Viable at +1 s | Viable at +2 s | Viable at +5 s |
|---|---|---|---|---|---|---|---|---|
| 0.01 USDC | 579 | 538 | 24 | 17 | 0 | 6 | 0 | 6 |
| 0.10 USDC | 538 | 514 | 14 | 10 | 0 | 2 | 0 | 4 |
| 0.50 USDC | 435 | 430 | 4 | 1 | 0 | 0 | 0 | 0 |
| 2.00 USDC | 58 | 57 | 1 | 0 | 0 | 0 | 0 | 0 |

- At the 0.10 USDC threshold, 95.5% of episodes (514 of 538) were closed by another transaction in the same block.
- Where "viable at +5 s" is larger than "+2 s", the extra cases are gaps that opened again, not gaps that lasted.
- The median surplus at the signal is 1.04 USDC per 1,000 USDC. The total surplus at the signal across all episodes is 636.78 USDC over 72 hours; this is a theoretical upper bound for an actor with zero latency.
- Of the 101,877 blocks that contain a swap, only 31 end with a surplus ≥ 0.10 USDC. End-of-block price gap: median 2.16 bps, p99 7.17 bps, maximum 41.37 bps.
- Input 10,000 USDC: 5 episodes at the 0.10 USDC threshold, all closed in the same block.

The full numbers are in `data/summary.json`.

## What this means for the project

This pool pair is already arbitraged atomically inside the block. A loop with about 1 second of latency cannot capture these opportunities. The data supports the claim that most callbacks for candidates on this pair will arrive after the margin is gone, so the filter and the revalidation are needed. The data does not support the claim that this strategy is profitable on this pair.

## Method

1. `fetch_swaps.py` fetches the `Swap` events of both pools through `eth_getLogs` from the public RPC `base-rpc.publicnode.com`, including `blockTimestampMs`.
2. `replay.py` builds the state of both pools in (block, log index) order and evaluates it after every transaction that contains a swap.
3. At each point, the USDC → WETH → USDC round trip surplus is computed for both directions with `quote.py`.
4. An episode starts when the best surplus rises to or above the threshold. Its duration ends at the first evaluation point where the surplus for the same direction drops below the threshold.
5. Viability at +1, +2 and +5 seconds is recomputed from the end-of-block state of the last block whose timestamp is ≤ signal + delay, with the same direction and input size.

## Assumptions and limitations

- **Single-tick quote.** State is taken from `sqrtPriceX96` and `liquidity` in the `Swap` event; a hypothetical swap is assumed not to cross a tick boundary. Validation: the implied fee of 29,245 real Uniswap V3 swaps is exactly 500 ppm at every percentile.
- **Dynamic Aerodrome fee.** The fee ranged over 100–892 ppm (p1–p99) in this window. The replay uses the fee actually charged on the last Aerodrome swap worth ≥ 100 USDC, not the `fee()` value at the evaluation block.
- **Liquidity changes between swaps** (mint and burn) only become visible at the next swap in that pool.
- **Gas and callback costs are not subtracted.** The surplus threshold stands in for those costs.
- **Time comes from block timestamps** (`blockTimestampMs`), not from a single observer.
- **Delay is counted from the signal block.** The real origin → Lasna → destination latency has not been measured yet and will add to the delay.
- One 72-hour window on one pool pair; the price fell 4.5% during this window.

## Re-running

```bash
python3 fetch_swaps.py
```

```bash
python3 replay.py > data/summary.json
```

```bash
python3 -m unittest -v
```

Requires Python 3.9+ with no extra dependencies. `data/swaps.csv` is about 24 MB.
