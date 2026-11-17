"""Replay of arbitrage between two concentrated-liquidity pools of the same pair on Base mainnet.

Evaluation point = state of both pools after every transaction that contains a swap.
Episode = the first point where the best surplus rises to or above the threshold (rising edge).
Survival = surplus in the same direction, with the same input size, at the end-of-block state of
the last block with timestamp <= signal + delay.

Usage:
  python3 replay.py                    WETH/USDC report in the original format (data/summary.json)
  python3 replay.py --pair DEGEN-WETH  one pair, English field names
  python3 replay.py --all              every pair in pairs.py whose swaps file exists
"""
import bisect
import csv
import json
import os
import sys
from collections import namedtuple

import pairs
from quote import Q96, round_trip, spot_price, stays_in_tick_range, token0_to_token1, token1_to_token0

USDC = 10 ** 6
REFERENCE = pairs.by_key("WETH-USDC")
SWAPS_PATH = REFERENCE.swaps_path
UNI_FEE_PPM = REFERENCE.pools[0].fee_ppm
MIN_USDC_FOR_IMPLIED_FEE = REFERENCE.min_fee_amount1
MIN_WETH_FOR_IMPLIED_FEE = REFERENCE.min_fee_amount0
MAX_IMPLIED_FEE_PPM = 20_000
DELAYS_MS = (1000, 2000, 5000)
LOOP_DELAY_MS = 2000  # p95 latency of the testnet loop
A_THEN_B, B_THEN_A = "a_then_b", "b_then_a"  # which pool the first leg trades on
DIRECTIONS = (A_THEN_B, B_THEN_A)
INPUTS_USDC = (1_000, 10_000)
THRESHOLDS_USDC = (0.01, 0.10, 0.50, 2.00)

Point = namedtuple("Point", "ts_ms block tx_hash a_sqrt a_liq a_tick a_fee b_sqrt b_liq b_tick b_fee")


def implied_fee_ppm(prev_sqrt, row_sqrt, liquidity, amount0, amount1,
                    min_amount0=MIN_WETH_FOR_IMPLIED_FEE, min_amount1=MIN_USDC_FOR_IMPLIED_FEE):
    """Fee actually charged on one swap, or None if the swap is too small to measure it."""
    if amount1 >= min_amount1:
        effective = liquidity * (row_sqrt - prev_sqrt) // Q96
        return round((1 - effective / amount1) * 1_000_000)
    if amount0 >= min_amount0:
        effective = liquidity * Q96 * (prev_sqrt - row_sqrt) // (prev_sqrt * row_sqrt)
        return round((1 - effective / amount0) * 1_000_000)
    return None


def load_points(pair=REFERENCE, path=None):
    """Builds one evaluation point per transaction, once both pools have a state and a fee."""
    specs = {pool.name: pool for pool in pair.pools}
    state = {name: None for name in specs}
    fees = {name: spec.fee_ppm for name, spec in specs.items()}
    a_name, b_name = (pool.name for pool in pair.pools)
    points = []
    pending = None
    with open(path or pair.swaps_path) as handle:
        for row in csv.DictReader(handle):
            name = row["pool"]
            sqrt_price, liquidity, tick = int(row["sqrt_price_x96"]), int(row["liquidity"]), int(row["tick"])
            previous = state[name]
            if specs[name].fee_ppm is None and previous and previous[1] == liquidity and previous[0] != sqrt_price:
                fee = implied_fee_ppm(previous[0], sqrt_price, liquidity, int(row["amount0"]), int(row["amount1"]),
                                      pair.min_fee_amount0, pair.min_fee_amount1)
                if fee is not None and 0 < fee < MAX_IMPLIED_FEE_PPM:
                    fees[name] = fee
            state[name] = (sqrt_price, liquidity, tick)
            if not (all(state.values()) and all(fees.values())):
                continue
            point = Point(int(row["ts_ms"]), int(row["block"]), row["tx_hash"],
                          *state[a_name], fees[a_name], *state[b_name], fees[b_name])
            if pending and pending.tx_hash != point.tx_hash:
                points.append(pending)
            pending = point
    if pending:
        points.append(pending)
    return points


def _pools(point, direction):
    a = (point.a_sqrt, point.a_liq, point.a_fee)
    b = (point.b_sqrt, point.b_liq, point.b_fee)
    return (a, b) if direction == A_THEN_B else (b, a)


def surplus(pair, point, direction, amount_in):
    """Round-trip surplus in raw quote-token units (can be negative)."""
    first, second = _pools(point, direction)
    return round_trip(first, second, amount_in, pair.quote_is_token1) - amount_in


def best_direction(pair, point, amount_in):
    """Best (surplus, direction). On a tie the first leg trades on pool a."""
    via_a = surplus(pair, point, A_THEN_B, amount_in)
    via_b = surplus(pair, point, B_THEN_A, amount_in)
    return (via_a, A_THEN_B) if via_a >= via_b else (via_b, B_THEN_A)


def legs_stay_in_tick_range(pair, point, direction, amount_in):
    """True if neither leg crosses a tick boundary, so the single-tick quote is exact."""
    first_spec, second_spec = pair.pools if direction == A_THEN_B else pair.pools[::-1]
    first_tick, second_tick = ((point.a_tick, point.b_tick) if direction == A_THEN_B
                               else (point.b_tick, point.a_tick))
    first, second = _pools(point, direction)
    out_leg, back_leg = ((token1_to_token0, token0_to_token1) if pair.quote_is_token1
                         else (token0_to_token1, token1_to_token0))
    middle, first_sqrt = out_leg(first[0], first[1], amount_in, first[2])
    _, second_sqrt = back_leg(second[0], second[1], middle, second[2])
    return (stays_in_tick_range(first_tick, first_sqrt, first_spec.tick_spacing)
            and stays_in_tick_range(second_tick, second_sqrt, second_spec.tick_spacing))


def find_episodes(pair, points, amount_in, threshold):
    """Returns the episodes with their survival at each delay, and the number of candidate points."""
    timestamps = [p.ts_ms for p in points]
    last_ts = timestamps[-1]
    episodes = []
    candidate_points = 0
    above = False
    for index, point in enumerate(points):
        signal_surplus, direction = best_direction(pair, point, amount_in)
        if signal_surplus < threshold:
            above = False
            continue
        candidate_points += 1
        if above:
            continue
        above = True
        if point.ts_ms + DELAYS_MS[-1] > last_ts:
            continue  # not enough data after the signal
        later = {}
        for delay in DELAYS_MS:
            arrival = points[bisect.bisect_right(timestamps, point.ts_ms + delay) - 1]
            later[delay] = surplus(pair, arrival, direction, amount_in)
        end = index
        while end + 1 < len(points) and surplus(pair, points[end + 1], direction, amount_in) >= threshold:
            end += 1
        closed_at = points[end + 1].ts_ms if end + 1 < len(points) else last_ts
        episodes.append({
            "ts_ms": point.ts_ms, "block": point.block, "tx_hash": point.tx_hash,
            "direction": direction, "surplus": signal_surplus, "later": later,
            "duration_ms": closed_at - point.ts_ms,
            "single_range": legs_stay_in_tick_range(pair, point, direction, amount_in),
        })
    return episodes, candidate_points


def percentile(values, fraction):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(fraction * len(ordered)))] if ordered else None


def summarize_pair(pair, points, amount_in, threshold):
    """Episode statistics for one input size and threshold, in whole quote-token units."""
    unit = 10 ** pair.quote_decimals
    episodes, candidate_points = find_episodes(pair, points, amount_in, threshold)
    count = len(episodes)
    summary = {"input": amount_in / unit, "threshold": threshold / unit,
               "candidate_points": candidate_points, "episodes": count}
    for delay in DELAYS_MS:
        alive = sum(1 for e in episodes if e["later"][delay] >= threshold)
        summary[f"viable_{delay // 1000}s"] = alive
        summary[f"viable_{delay // 1000}s_pct"] = round(100 * alive / count, 1) if count else None
    durations = [e["duration_ms"] for e in episodes]
    summary["duration_p50_ms"] = percentile(durations, 0.5)
    summary["duration_p95_ms"] = percentile(durations, 0.95)
    summary["signal_surplus_p50"] = (
        round(percentile([e["surplus"] for e in episodes], 0.5) / unit, 3) if count else None)
    summary["signal_surplus_total"] = round(sum(e["surplus"] for e in episodes) / unit, 2)
    # Upper bound on what a loop that acts LOOP_DELAY_MS after the signal could have captured.
    captured = [e["later"][LOOP_DELAY_MS] for e in episodes if e["later"][LOOP_DELAY_MS] >= threshold]
    summary["viable_2s_surplus_total"] = round(sum(captured) / unit, 6)
    summary["single_range_pct"] = (
        round(100 * sum(1 for e in episodes if e["single_range"]) / count, 1) if count else None)
    return summary, episodes


def duration_counts(episodes):
    """Groups episodes by how long the gap stays above the threshold."""
    limits = (("same_block", 0), ("one_block", 200), ("up_to_1s", 1000), ("up_to_5s", 5000))
    counts = {label: 0 for label, _ in limits}
    counts["over_5s"] = 0
    for episode in episodes:
        label = next((name for name, limit in limits if episode["duration_ms"] <= limit), "over_5s")
        counts[label] += 1
    return counts


def block_end_points(points):
    """State after the last swap of each block: what an observer with >= 1 block of latency can still see."""
    return [p for i, p in enumerate(points) if i + 1 == len(points) or points[i + 1].block != p.block]


def block_end_summary(pair, points, amount_in, threshold):
    ends = block_end_points(points)
    gaps_bps = sorted(abs(spot_price(p.a_sqrt, pair.decimals0, pair.decimals1)
                          / spot_price(p.b_sqrt, pair.decimals0, pair.decimals1) - 1) * 1e4 for p in ends)
    best = [best_direction(pair, p, amount_in)[0] for p in ends]
    return {
        "blocks_with_swap": len(ends),
        "gap_bps_p50": round(percentile(gaps_bps, 0.5), 2),
        "gap_bps_p99": round(percentile(gaps_bps, 0.99), 2),
        "gap_bps_max": round(gaps_bps[-1], 2),
        "viable_block_ends": sum(1 for s in best if s >= threshold),
        "max_surplus": round(max(best) / 10 ** pair.quote_decimals, 3),
    }


def base_price(pair, sqrt_price):
    """Price of one base token in the quote token."""
    price = spot_price(sqrt_price, pair.decimals0, pair.decimals1)
    return price if pair.quote_is_token1 else 1 / price


def pair_report(pair, points):
    report = {
        "pair": pair.key,
        "pools": {pool.name: pool.address for pool in pair.pools},
        "evaluation_points": len(points),
        "hours": round((points[-1].ts_ms - points[0].ts_ms) / 3_600_000, 1),
        "price_start": float(f"{base_price(pair, points[0].a_sqrt):.6g}"),
        "price_end": float(f"{base_price(pair, points[-1].a_sqrt):.6g}"),
        "summary": [], "durations": {}, "block_ends": {},
    }
    for amount_in in pair.inputs:
        for threshold in pair.thresholds:
            summary, episodes = summarize_pair(pair, points, amount_in, threshold)
            report["summary"].append(summary)
            key = f"{summary['input']:g}@{summary['threshold']:g}"
            report["durations"][key] = duration_counts(episodes)
            report["block_ends"][key] = block_end_summary(pair, points, amount_in, threshold)
    return report


# The original WETH/USDC report keeps its Indonesian field names so data/summary.json, which is
# committed evidence, stays byte-for-byte reproducible.
LEGACY_SUMMARY_KEYS = {
    "input": "input_usdc", "threshold": "ambang_usdc", "candidate_points": "titik_kandidat",
    "episodes": "episode", "viable_1s": "layak_1s", "viable_1s_pct": "layak_1s_pct",
    "viable_2s": "layak_2s", "viable_2s_pct": "layak_2s_pct", "viable_5s": "layak_5s",
    "viable_5s_pct": "layak_5s_pct", "duration_p50_ms": "durasi_p50_ms", "duration_p95_ms": "durasi_p95_ms",
    "signal_surplus_p50": "surplus_sinyal_p50_usdc", "signal_surplus_total": "total_surplus_sinyal_usdc",
}
LEGACY_DURATION_KEYS = {"same_block": "blok_sama", "one_block": "satu_blok_200ms", "up_to_1s": "sampai_1s",
                        "up_to_5s": "sampai_5s", "over_5s": "lebih_5s"}
LEGACY_BLOCK_END_KEYS = {"blocks_with_swap": "blok_dengan_swap", "gap_bps_p50": "gap_bps_p50",
                         "gap_bps_p99": "gap_bps_p99", "gap_bps_max": "gap_bps_maks",
                         "viable_block_ends": "akhir_blok_layak", "max_surplus": "surplus_maks_usdc"}


def _rename(values, names):
    return {names[key]: value for key, value in values.items() if key in names}


def summarize(points, usdc_in, threshold):
    summary, episodes = summarize_pair(REFERENCE, points, usdc_in, threshold)
    return _rename(summary, LEGACY_SUMMARY_KEYS), episodes


def duration_buckets(episodes):
    return _rename(duration_counts(episodes), LEGACY_DURATION_KEYS)


def legacy_report(points):
    report = {
        "titik_evaluasi": len(points),
        "jam": round((points[-1].ts_ms - points[0].ts_ms) / 3_600_000, 1),
        "harga_awal": round(spot_price(points[0].a_sqrt, 18, 6), 2),
        "harga_akhir": round(spot_price(points[-1].a_sqrt, 18, 6), 2),
        "ringkasan": [], "durasi": {}, "akhir_blok": {},
    }
    for usdc_in in INPUTS_USDC:
        for threshold_usdc in THRESHOLDS_USDC:
            threshold = int(threshold_usdc * USDC)
            summary, episodes = summarize(points, usdc_in * USDC, threshold)
            report["ringkasan"].append(summary)
            key = f"{usdc_in}@{threshold_usdc}"
            report["durasi"][key] = duration_buckets(episodes)
            report["akhir_blok"][key] = _rename(block_end_summary(REFERENCE, points, usdc_in * USDC, threshold),
                                                LEGACY_BLOCK_END_KEYS)
    return report


def main(argv):
    if not argv:
        json.dump(legacy_report(load_points()), sys.stdout, indent=1)
        return
    if argv[0] == "--pair" and len(argv) == 2:
        selected = [pairs.by_key(argv[1])]
    elif argv[0] == "--all":
        selected = [p for p in pairs.PAIRS if os.path.exists(p.swaps_path)]
    else:
        sys.exit(__doc__)
    reports = [pair_report(pair, load_points(pair)) for pair in selected]
    json.dump(reports[0] if argv[0] == "--pair" else reports, sys.stdout, indent=1)


if __name__ == "__main__":
    main(sys.argv[1:])
