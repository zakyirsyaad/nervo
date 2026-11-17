"""Replay of WETH/USDC arbitrage between Uniswap V3 0.05% and Aerodrome Slipstream on Base mainnet.

Evaluation point = state of both pools after every transaction that contains a swap.
Episode = the first point where the best surplus rises to or above the threshold (rising edge).
Survival = surplus in the same direction, with the same input size, at the end-of-block state of
the last block with timestamp <= signal + delay.
"""
import bisect
import csv
import json
import sys
from collections import namedtuple

from quote import Q96, round_trip_usdc, spot_price_usdc_per_weth

SWAPS_PATH = "data/swaps.csv"
UNI_FEE_PPM = 500
USDC = 10 ** 6
MIN_USDC_FOR_IMPLIED_FEE = 100 * USDC
MIN_WETH_FOR_IMPLIED_FEE = 5 * 10 ** 16
DELAYS_MS = (1000, 2000, 5000)
DIRECTIONS = ("beli_uni_jual_aero", "beli_aero_jual_uni")  # buy Uni sell Aero, buy Aero sell Uni
INPUTS_USDC = (1_000, 10_000)
THRESHOLDS_USDC = (0.01, 0.10, 0.50, 2.00)

Point = namedtuple("Point", "ts_ms block tx_hash uni_sqrt uni_liq aero_sqrt aero_liq aero_fee")


def implied_fee_ppm(prev_sqrt, row_sqrt, liquidity, amount0, amount1):
    """Fee actually charged on one swap, or None if the swap is too small."""
    if amount1 >= MIN_USDC_FOR_IMPLIED_FEE:
        effective = liquidity * (row_sqrt - prev_sqrt) // Q96
        return round((1 - effective / amount1) * 1_000_000)
    if amount0 >= MIN_WETH_FOR_IMPLIED_FEE:
        effective = liquidity * Q96 * (prev_sqrt - row_sqrt) // (prev_sqrt * row_sqrt)
        return round((1 - effective / amount0) * 1_000_000)
    return None


def load_points(path=SWAPS_PATH):
    """Builds one evaluation point per transaction. Starts once both pools have a state and a fee."""
    uni = aero = None
    aero_fee = None
    points = []
    pending = None
    with open(path) as handle:
        for row in csv.DictReader(handle):
            sqrt_price, liquidity = int(row["sqrt_price_x96"]), int(row["liquidity"])
            if row["pool"] == "univ3":
                uni = (sqrt_price, liquidity)
            else:
                if aero and aero[1] == liquidity and aero[0] != sqrt_price:
                    fee = implied_fee_ppm(aero[0], sqrt_price, liquidity,
                                          int(row["amount0"]), int(row["amount1"]))
                    if fee is not None and 0 < fee < 20_000:
                        aero_fee = fee
                aero = (sqrt_price, liquidity)
            if not (uni and aero and aero_fee):
                continue
            point = Point(int(row["ts_ms"]), int(row["block"]), row["tx_hash"],
                          uni[0], uni[1], aero[0], aero[1], aero_fee)
            if pending and pending.tx_hash != point.tx_hash:
                points.append(pending)
            pending = point
    if pending:
        points.append(pending)
    return points


def surplus_usdc(point, direction, usdc_in, aero_fee=None):
    """Round trip surplus in raw USDC units (can be negative)."""
    uni = (point.uni_sqrt, point.uni_liq, UNI_FEE_PPM)
    aero = (point.aero_sqrt, point.aero_liq, point.aero_fee if aero_fee is None else aero_fee)
    buy, sell = (uni, aero) if direction == DIRECTIONS[0] else (aero, uni)
    return round_trip_usdc(buy, sell, usdc_in) - usdc_in


def best_direction(point, usdc_in):
    return max(((surplus_usdc(point, d, usdc_in), d) for d in DIRECTIONS))


def find_episodes(points, usdc_in, threshold):
    """Returns the list of episodes with their survival at each delay."""
    timestamps = [p.ts_ms for p in points]
    last_ts = timestamps[-1]
    episodes = []
    candidate_points = 0
    above = False
    for index, point in enumerate(points):
        surplus, direction = best_direction(point, usdc_in)
        if surplus < threshold:
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
            later[delay] = surplus_usdc(arrival, direction, usdc_in)
        end = index
        while end + 1 < len(points) and surplus_usdc(points[end + 1], direction, usdc_in) >= threshold:
            end += 1
        closed_at = points[end + 1].ts_ms if end + 1 < len(points) else last_ts
        episodes.append({
            "ts_ms": point.ts_ms, "block": point.block, "tx_hash": point.tx_hash,
            "direction": direction, "surplus": surplus, "later": later,
            "duration_ms": closed_at - point.ts_ms,
        })
    return episodes, candidate_points


def percentile(values, fraction):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(fraction * len(ordered)))] if ordered else None


def summarize(points, usdc_in, threshold):
    episodes, candidate_points = find_episodes(points, usdc_in, threshold)
    count = len(episodes)
    # ambang = threshold, titik_kandidat = candidates, layak = viable, durasi = duration, sinyal = signal.
    summary = {
        "input_usdc": usdc_in / USDC, "ambang_usdc": threshold / USDC,
        "titik_kandidat": candidate_points, "episode": count,
    }
    for delay in DELAYS_MS:
        alive = sum(1 for e in episodes if e["later"][delay] >= threshold)
        summary[f"layak_{delay // 1000}s"] = alive
        summary[f"layak_{delay // 1000}s_pct"] = round(100 * alive / count, 1) if count else None
    durations = [e["duration_ms"] for e in episodes]
    summary["durasi_p50_ms"] = percentile(durations, 0.5)
    summary["durasi_p95_ms"] = percentile(durations, 0.95)
    summary["surplus_sinyal_p50_usdc"] = (
        round(percentile([e["surplus"] for e in episodes], 0.5) / USDC, 3) if count else None)
    summary["total_surplus_sinyal_usdc"] = round(sum(e["surplus"] for e in episodes) / USDC, 2)
    return summary, episodes


def duration_buckets(episodes):
    """Groups episodes by how long the gap stays above the threshold."""
    # blok_sama = same block, satu_blok = one block, sampai = up to, lebih = more than.
    labels = (("blok_sama", 0), ("satu_blok_200ms", 200), ("sampai_1s", 1000), ("sampai_5s", 5000))
    counts = {label: 0 for label, _ in labels}
    counts["lebih_5s"] = 0
    for episode in episodes:
        label = next((name for name, limit in labels if episode["duration_ms"] <= limit), "lebih_5s")
        counts[label] += 1
    return counts


def block_end_points(points):
    """State after the last swap of each block: what an observer with >= 1 block of latency can still see."""
    return [p for i, p in enumerate(points) if i + 1 == len(points) or points[i + 1].block != p.block]


def block_end_stats(points, usdc_in, threshold):
    ends = block_end_points(points)
    gaps_bps = sorted(abs(spot_price_usdc_per_weth(p.uni_sqrt) / spot_price_usdc_per_weth(p.aero_sqrt) - 1) * 1e4
                      for p in ends)
    best = [best_direction(p, usdc_in)[0] for p in ends]
    # blok_dengan_swap = blocks with a swap, maks = max, akhir_blok_layak = viable end-of-block states.
    return {
        "blok_dengan_swap": len(ends),
        "gap_bps_p50": round(percentile(gaps_bps, 0.5), 2),
        "gap_bps_p99": round(percentile(gaps_bps, 0.99), 2),
        "gap_bps_maks": round(gaps_bps[-1], 2),
        "akhir_blok_layak": sum(1 for s in best if s >= threshold),
        "surplus_maks_usdc": round(max(best) / USDC, 3),
    }


def main():
    points = load_points()
    # titik_evaluasi = evaluation points, jam = hours, harga_awal/akhir = start/end price,
    # ringkasan = summary, durasi = duration, akhir_blok = end of block.
    report = {
        "titik_evaluasi": len(points),
        "jam": round((points[-1].ts_ms - points[0].ts_ms) / 3_600_000, 1),
        "harga_awal": round(spot_price_usdc_per_weth(points[0].uni_sqrt), 2),
        "harga_akhir": round(spot_price_usdc_per_weth(points[-1].uni_sqrt), 2),
        "ringkasan": [], "durasi": {}, "akhir_blok": {},
    }
    for usdc_in in INPUTS_USDC:
        for threshold_usdc in THRESHOLDS_USDC:
            threshold = int(threshold_usdc * USDC)
            summary, episodes = summarize(points, usdc_in * USDC, threshold)
            report["ringkasan"].append(summary)
            key = f"{usdc_in}@{threshold_usdc}"
            report["durasi"][key] = duration_buckets(episodes)
            report["akhir_blok"][key] = block_end_stats(points, usdc_in * USDC, threshold)
    json.dump(report, sys.stdout, indent=1)


if __name__ == "__main__":
    main()
