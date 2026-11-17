"""Cross-chain replay: ETH/USDC on Base against ETH/USDC on Unichain, same 72-hour window.

A cross-chain arbitrageur holds USDC and ETH on both chains. When the prices differ it buys ETH on
the cheaper chain and sells the same amount on the dearer one at the same time, and rebalances its
inventory between chains from time to time. The surplus of one opportunity is the USDC from the
sell minus the USDC spent on the buy: the same arithmetic as a round trip across two pools, so the
episode logic of replay.py is reused unchanged.

Unlike two pools on one chain, the two legs cannot be settled atomically inside one block, so no
searcher can close a gap in the same block it opened. That is the case the same-chain replay could
not cover.

Pools: Base Uniswap V3 WETH/USDC 0.05% and Unichain Uniswap V4 ETH/USDC 0.05% (no hooks), the
busiest pool of the pair on each chain. Both quote ETH as token0 and USDC as token1.

Timing: Base timestamps have 200 ms resolution; Unichain has one block per second and only a
seconds timestamp. A Unichain swap happened somewhere in [timestamp, timestamp + 1 s), so the
replay places it at the midpoint and reports how the results move at either end.

Usage: python3 crosschain.py > data/crosschain-summary.json
"""
import csv
import json
import sys

import pairs
import replay
from quote import spot_price

USDC = 10 ** 6
BASE_PATH = "data/swaps.csv"
UNICHAIN_PATH = "data/swaps-unichain-ETH-USDC.csv"
BASE_POOL_NAME = "univ3"
UNICHAIN_POOL_ID = "0x3258f413c7a88cda2fa8709a589d221a80f6574f63df5a5b6774485d8acc39d9"
UNICHAIN_OFFSETS_MS = (0, 500, 1000)
MAIN_OFFSET_MS = 500
GAP_LEVELS_BPS = (5, 10, 20, 50)

PAIR = pairs.Pair(
    "ETH-USDC-Base-Unichain", "ETH", "USDC", 18, 6, True,
    (pairs.Pool("base-v3", "0xd0b53d9277642d899df5c87a3966a349a798f224", 500, 10),
     pairs.Pool("unichain-v4", UNICHAIN_POOL_ID, None, 10)),  # V4 reports the fee in every Swap event
    inputs=(1_000 * USDC, 10_000 * USDC), thresholds=(USDC // 10, USDC // 2, 2 * USDC))


def _events(base_path, unichain_path, unichain_offset_ms):
    """Swaps of both pools as (ts_ms, chain order, block, log index, chain, row), sorted by time."""
    events = []
    with open(base_path) as handle:
        for row in csv.DictReader(handle):
            if row["pool"] == BASE_POOL_NAME:
                events.append((int(row["ts_ms"]), 0, int(row["block"]), int(row["log_index"]), "base", row))
    with open(unichain_path) as handle:
        for row in csv.DictReader(handle):
            ts_ms = int(row["ts_ms"]) + unichain_offset_ms
            events.append((ts_ms, 1, int(row["block"]), int(row["log_index"]), "unichain", row))
    events.sort(key=lambda event: event[:4])
    return events


def load_points(base_path=BASE_PATH, unichain_path=UNICHAIN_PATH, unichain_offset_ms=MAIN_OFFSET_MS):
    """One evaluation point per transaction on either chain, once both pools have a state."""
    base_fee = PAIR.pools[0].fee_ppm
    state = {"base": None, "unichain": None}
    unichain_fee = None
    points = []
    pending = None
    for ts_ms, _, block, _, chain, row in _events(base_path, unichain_path, unichain_offset_ms):
        state[chain] = (int(row["sqrt_price_x96"]), int(row["liquidity"]), int(row["tick"]))
        if chain == "unichain":
            unichain_fee = int(row["fee"])
        if state["base"] is None or state["unichain"] is None:
            continue
        point = replay.Point(ts_ms, block, row["tx_hash"], *state["base"], base_fee, *state["unichain"], unichain_fee)
        if pending and pending.tx_hash != point.tx_hash:
            points.append(pending)
        pending = point
    if pending:
        points.append(pending)
    return points


def gap_bps(point):
    return abs(spot_price(point.a_sqrt, 18, 6) / spot_price(point.b_sqrt, 18, 6) - 1) * 1e4


def gap_time_share(points, levels_bps):
    """Share of time, in percent, during which the price gap between the chains exceeded each level."""
    total = points[-1].ts_ms - points[0].ts_ms
    above = {level: 0 for level in levels_bps}
    for current, following in zip(points, points[1:]):
        held = following.ts_ms - current.ts_ms
        gap = gap_bps(current)
        for level in levels_bps:
            if gap > level:
                above[level] += held
    return {level: round(100 * above[level] / total, 3) for level in levels_bps}


def run(points):
    summaries, durations = [], {}
    for amount_in in PAIR.inputs:
        for threshold in PAIR.thresholds:
            summary, episodes = replay.summarize_pair(PAIR, points, amount_in, threshold)
            summaries.append(summary)
            durations[f"{summary['input']:g}@{summary['threshold']:g}"] = replay.duration_counts(episodes)
    return summaries, durations


def report():
    points = load_points()
    summaries, durations = run(points)
    sensitivity = {}
    for offset in UNICHAIN_OFFSETS_MS:
        shifted_summaries, _ = run(load_points(unichain_offset_ms=offset)) if offset != MAIN_OFFSET_MS else (
            summaries, None)
        sensitivity[f"{offset}ms"] = {f"{s['input']:g}@{s['threshold']:g}": {
            "episodes": s["episodes"], "viable_1s": s["viable_1s"], "viable_2s": s["viable_2s"],
            "viable_5s": s["viable_5s"]} for s in shifted_summaries}
    gaps = sorted(gap_bps(p) for p in points)
    return {
        "pair": PAIR.key,
        "pools": {"base-v3": PAIR.pools[0].address, "unichain-v4": UNICHAIN_POOL_ID},
        "evaluation_points": len(points),
        "hours": round((points[-1].ts_ms - points[0].ts_ms) / 3_600_000, 1),
        "unichain_offset_ms": MAIN_OFFSET_MS,
        "gap_bps_at_points": {"p50": round(replay.percentile(gaps, 0.5), 2),
                              "p99": round(replay.percentile(gaps, 0.99), 2), "max": round(gaps[-1], 2)},
        "gap_time_share_pct": {f"over_{level}bps": share for level, share in gap_time_share(points, GAP_LEVELS_BPS).items()},
        "summary": summaries,
        "durations": durations,
        "sensitivity_to_unichain_timing": sensitivity,
    }


if __name__ == "__main__":
    json.dump(report(), sys.stdout, indent=1)
