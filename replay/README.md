# Market replay on Base mainnet

Answers the market validation question: how many arbitrage episodes between two real pools are still viable 1, 2 and 5 seconds after the signal. The testnet loop acts 1.4 s after the signal at the median and 2.0 s at p95, so the +2 s column is the one that matters.

The replay ran first on WETH/USDC, then on nine more pairs to check whether WETH/USDC is a special case, and finally on ETH/USDC across two chains, Base and Unichain. In every case the gaps close within about a second.

## WETH/USDC

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

## Nine more pairs

Same 72-hour window. For each pair, the two pools with the most swaps were picked from the Uniswap V3 and Aerodrome Slipstream factories; addresses are in [pairs.py](pairs.py). The set covers blue chips, a stablecoin FX pair and long-tail tokens.

Input about 1,000 USD (1,000 USDC or 0.5 WETH), threshold about 0.10 USD (0.10 USDC or 0.00005 WETH):

| Pair | Swaps | Round-trip fee, bps | Block-end gap p50 / p99, bps | Episodes | Closed in the same block | Viable at +2 s | Blocks ending above the threshold |
|---|---|---|---|---|---|---|---|
| WETH/USDC | 134,365 | 6.5 | 2.2 / 7.2 | 538 | 514 | 0 | 31 |
| cbBTC/USDC | 42,891 | 10.0 | 0.9 / 8.4 | 99 | 96 | 0 | 4 |
| cbBTC/WETH | 23,940 | 5.8 | 2.4 / 6.3 | 0 | 0 | 0 | 0 |
| EURC/USDC | 9,700 | 5.7 | 3.0 / 5.9 | 16 | 16 | 0 | 0 |
| VIRTUAL/WETH | 23,237 | 6.4 | 2.1 / 9.5 | 5 | 5 | 0 | 0 |
| ZORA/USDC | 10,138 | 55.0 | 6.5 / 33.0 | 0 | 0 | 0 | 0 |
| MORPHO/WETH | 8,972 | 57.1 | 3.2 / 10.6 | 0 | 0 | 0 | 0 |
| AERO/WETH | 5,608 | 60.3 | 2.6 / 29.1 | 8 | 8 | 0 | 0 |
| DEGEN/WETH | 2,588 | 124.6 | 55.1 / 111.8 | 0 | 0 | 0 | 0 |
| BRETT/WETH | 3,339 | 121.0 | 51.3 / 104.5 | 0 | 0 | 0 | 0 |

The round-trip fee is the sum of both pools' median fees over the window. The block-end gap is the price difference between the two pools after the last swap of each block.

- **No pair had an episode still viable 1, 2 or 5 seconds after the signal**, at any of the three sizes tried (about 100, 1,000 and 10,000 USD). Across the nine new pairs at the 0.10 USD threshold there were 231 episodes; 226 closed in the block they opened and the other five within one second.
- **Low-fee pairs** (cbBTC/USDC, EURC/USDC, VIRTUAL/WETH) behave like WETH/USDC: gaps above the fees open, and other traders close them inside the block.
- **High-fee long-tail pairs** have wider and longer-lived gaps (DEGEN/WETH sits 55 bps apart at a typical block end), but the gaps stay inside the fee band of 121–125 bps, so there is nothing to trade.
- The best surplus at any block end was negative for seven of the nine pairs.

Full numbers, including the 2.00 USD threshold, are in `data/pairs-summary.json`.

## Across chains: Base and Unichain

Two pools on one chain can be arbitraged atomically inside a block. Two pools on different chains cannot, so this is where a seconds-scale loop like ours should have its best chance. [crosschain.py](crosschain.py) compares ETH/USDC on Base (Uniswap V3 0.05%, the pool above) with the busiest ETH/USDC pool on Unichain (Uniswap V4, native ETH, 0.05%, no hooks, pool id `0x3258f413…8acc39d9`) over the same 72 hours. Unichain had 24,894 swaps in that pool; its liquidity was about 13 times smaller than the Base pool's.

A cross-chain arbitrageur holds inventory on both chains, buys ETH on the cheaper chain and sells it on the dearer one at the same time. The surplus is computed with the same round-trip arithmetic as above.

| Input, threshold | Episodes | Closed at the same timestamp | Still viable at +1 s | +2 s | +5 s |
|---|---|---|---|---|---|
| 1,000 USDC, 0.10 USDC | 150 | 108 | 7 | 1 | 0 |
| 1,000 USDC, 0.50 USDC | 112 | 86 | 3 | 0 | 0 |
| 1,000 USDC, 2.00 USDC | 45 | 38 | 0 | 0 | 0 |
| 10,000 USDC, any of the three | 1 | 0 | 0 | 0 | 0 |

- **The two chains stay within a few basis points of each other.** The gap is 1.6 bps at the median and 13.8 bps at p99. It exceeded the combined 10 bps fee for 0.08% of the 72 hours, about 3.5 minutes in total.
- **Gaps close within a second or two.** No episode lasted longer than 2 seconds. 92 of the 150 episodes at the 0.10 USDC threshold were opened by a swap on Unichain and 58 by one on Base; most closed at the same timestamp, which means within the same Unichain block or the same 200 ms Base block.
- **A loop acting 2 seconds later would have caught one opportunity in 72 hours,** worth 0.86 USDC on 1,000 USDC.
- **Timing sensitivity.** Unichain timestamps have one-second resolution, so each Unichain swap is placed at the middle of its second. Placing it at the start or the end of the second gives 0 to 2 episodes still viable at +2 s instead of 1; the conclusion does not change.

The likely reason: each chain is kept close to the price on centralised exchanges by traders who correct a pool right after the swap that moved it, within the same block. Those traders do not need both chains at once, so the cross-chain gap never gets the chance to open wide.

Caveat: a 1,000 USDC trade moves the shallow Unichain pool by about 11 bps, more than one tick-spacing range, so the Unichain leg is quoted with the single-tick approximation (`single_range_pct` is 0). The gap and timing statistics do not depend on it. Full numbers: `data/crosschain-summary.json`.

## What this means for the project

On Base, arbitrage between two pools on the same chain is settled inside the block, by searchers who trade right behind the swap that opened the gap. Between Base and Unichain the picture is the same one second later: both chains track the wider market so closely that a gap worth trading rarely survives two seconds. A loop that acts 1.4 to 2 seconds after the signal, which is what a reactive design across chains costs, cannot win this race on these markets.

The testnet results prove the mechanism, the integration and the latency. The replays show that, on the most traded pairs of Base and Unichain, that latency is not enough for profitable arbitrage. They also show why both halves of the design matter: the filter on Lasna avoids paying for callbacks that the executor would reject, and the executor's re-check is what keeps a late callback from trading at a loss.

## Method

1. `fetch_swaps.py` fetches the `Swap` events of both pools through `eth_getLogs` from the public RPC `base-rpc.publicnode.com`, including `blockTimestampMs`.
2. `replay.py` builds the state of both pools in (block, log index) order and evaluates it after every transaction that contains a swap.
3. At each point, the quote → base → quote round-trip surplus (USDC → WETH → USDC for WETH/USDC) is computed for both directions with `quote.py`.
4. An episode starts when the best surplus rises to or above the threshold. Its duration ends at the first evaluation point where the surplus for the same direction drops below the threshold.
5. Viability at +1, +2 and +5 seconds is recomputed from the end-of-block state of the last block whose timestamp is ≤ signal + delay, with the same direction and input size.

## Assumptions and limitations

- **Single-tick quote.** State is taken from `sqrtPriceX96` and `liquidity` in the `Swap` event; a hypothetical swap is assumed not to cross a tick boundary. Validation: the implied fee of 29,245 real Uniswap V3 swaps is exactly 500 ppm at every percentile. For every episode, `single_range_pct` in `data/pairs-summary.json` reports how often both legs stay inside the current tick-spacing range, where the quote is exact. It is high for small trades and for WETH/USDC and cbBTC/USDC at 1,000 USD, and low for 10,000 USD trades and for pairs with a tick-spacing-1 pool (cbBTC/WETH, EURC/USDC). Where it is low the quote is an approximation, and the episode counts for that size are less certain.
- **Dynamic Aerodrome fee.** On WETH/USDC the fee ranged over 100–892 ppm (p1–p99) in this window. The replay uses the fee actually charged on the last Aerodrome swap that is large enough to measure it (≥ 100 USDC on WETH/USDC), not the `fee()` value at the evaluation block.
- **Liquidity changes between swaps** (mint and burn) only become visible at the next swap in that pool.
- **Gas and callback costs are not subtracted.** The surplus threshold stands in for those costs.
- **Time comes from block timestamps** (`blockTimestampMs`), not from a single observer.
- **Delay is counted from the signal block.** The measured testnet loop takes 1.4 s at the median and 2.0 s at p95 from the trigger block to the callback block.
- One 72-hour window; WETH fell 4.5% during it. On Base, Uniswap V4 pools and Aerodrome's classic (non-concentrated) pools are not covered. Across chains, only the busiest pool on each side is compared, and Unichain timestamps have one-second resolution.

## Re-running

WETH/USDC, which reproduces `data/summary.json` exactly:

```bash
python3 fetch_swaps.py
```

```bash
python3 replay.py > data/summary.json
```

Base against Unichain (needs `data/swaps.csv` from the first step):

```bash
python3 fetch_unichain.py
```

```bash
python3 crosschain.py > data/crosschain-summary.json
```

The other nine pairs:

```bash
python3 fetch_swaps.py --all
```

```bash
python3 replay.py --all > data/pairs-summary.json
```

One pair: `python3 fetch_swaps.py DEGEN-WETH` and `python3 replay.py --pair DEGEN-WETH`. Tests:

```bash
python3 -m unittest -v
```

Requires Python 3.9+ with no extra dependencies. `data/swaps.csv` is about 24 MB; the other pairs are smaller.
