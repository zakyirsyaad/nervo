"""Tests for the cross-chain replay (Base Uniswap V3 against Unichain Uniswap V4). Run: python3 -m unittest -v"""
import csv
import os
import tempfile
import unittest

import crosschain
import replay

SQRT = 3558871971696076658134608  # about 2,017.7 USDC per ETH
LIQUIDITY = 528215498784700374
TICK = -200223
USDC = 10 ** 6
BASE_FIELDS = ["block", "log_index", "ts_ms", "pool", "tx_hash", "amount0", "amount1", "sqrt_price_x96",
               "liquidity", "tick"]
UNICHAIN_FIELDS = BASE_FIELDS + ["fee"]


def shifted(sqrt_price, bps):
    return int(sqrt_price * (1 + bps / 10_000) ** 0.5)


def write_csv(path, fields, rows):
    with open(path, "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def base_row(ts_ms, block, sqrt_price, pool="univ3", tx=None):
    return {"block": block, "log_index": 0, "ts_ms": ts_ms, "pool": pool, "tx_hash": tx or f"0xb{block}",
            "amount0": 0, "amount1": 0, "sqrt_price_x96": sqrt_price, "liquidity": LIQUIDITY, "tick": TICK}


def unichain_row(ts_ms, block, sqrt_price, fee=500):
    row = base_row(ts_ms, block, sqrt_price, pool="unichain-v4", tx=f"0xu{block}")
    row["fee"] = fee
    return row


class MergeTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.base_path = os.path.join(self.dir.name, "base.csv")
        self.unichain_path = os.path.join(self.dir.name, "unichain.csv")

    def tearDown(self):
        self.dir.cleanup()

    def test_merges_both_chains_in_time_order_and_ignores_other_base_pools(self):
        write_csv(self.base_path, BASE_FIELDS, [
            base_row(0, 1, SQRT), base_row(200, 2, SQRT, pool="aero"), base_row(1_400, 8, SQRT)])
        write_csv(self.unichain_path, UNICHAIN_FIELDS, [unichain_row(1_000, 100, SQRT, fee=480)])

        points = crosschain.load_points(self.base_path, self.unichain_path, unichain_offset_ms=0)

        self.assertEqual([p.ts_ms for p in points], [1_000, 1_400])
        self.assertEqual({p.b_fee for p in points}, {480})
        self.assertEqual({p.a_fee for p in points}, {500})

    def test_offset_moves_unichain_events_later(self):
        write_csv(self.base_path, BASE_FIELDS, [
            base_row(0, 1, SQRT), base_row(1_400, 8, SQRT), base_row(1_600, 9, SQRT)])
        write_csv(self.unichain_path, UNICHAIN_FIELDS, [unichain_row(1_000, 100, SQRT)])

        points = crosschain.load_points(self.base_path, self.unichain_path, unichain_offset_ms=500)

        self.assertEqual([p.ts_ms for p in points], [1_500, 1_600])

    def test_gap_that_lasts_three_seconds_is_still_viable_after_two(self):
        rich = shifted(SQRT, 40)
        base_rows = [base_row(t, t // 200 + 1, SQRT) for t in range(0, 12_000, 200)]
        write_csv(self.base_path, BASE_FIELDS, base_rows)
        write_csv(self.unichain_path, UNICHAIN_FIELDS, [
            unichain_row(0, 100, SQRT), unichain_row(1_000, 101, rich), unichain_row(4_000, 104, SQRT)])
        points = crosschain.load_points(self.base_path, self.unichain_path, unichain_offset_ms=0)

        summary, episodes = replay.summarize_pair(crosschain.PAIR, points, 1_000 * USDC, 2 * USDC)

        self.assertEqual(summary["episodes"], 1)
        self.assertEqual(summary["viable_2s"], 1)
        self.assertEqual(summary["viable_5s"], 0)
        self.assertEqual(episodes[0]["duration_ms"], 3_000)


class GapTimeTest(unittest.TestCase):
    def test_time_share_counts_how_long_the_gap_stayed_above_each_level(self):
        rich = shifted(SQRT, 30)
        points = [
            replay.Point(0, 1, "0xa", SQRT, LIQUIDITY, TICK, 500, SQRT, LIQUIDITY, TICK, 500),
            replay.Point(1_000, 2, "0xb", SQRT, LIQUIDITY, TICK, 500, rich, LIQUIDITY, TICK, 500),
            replay.Point(4_000, 3, "0xc", SQRT, LIQUIDITY, TICK, 500, SQRT, LIQUIDITY, TICK, 500),
        ]

        shares = crosschain.gap_time_share(points, (10, 50))

        self.assertAlmostEqual(shares[10], 75.0)  # 3 of 4 seconds above 10 bps
        self.assertAlmostEqual(shares[50], 0.0)


if __name__ == "__main__":
    unittest.main()
