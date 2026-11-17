"""Tests for the multi-pair replay: generic quote math, tick-range check and pair configs.

Run: python3 -m unittest -v
"""
import unittest

import pairs
import replay
from quote import Q96, round_trip, spot_price, stays_in_tick_range, tick_at, token0_to_token1, token1_to_token0

# A real Uniswap V3 WETH/USDC state from Base mainnet (block 55698123).
SQRT = 3558871971696076658134608
LIQUIDITY = 528215498784700374
TICK = -200223
USDC = 10 ** 6
WETH = 10 ** 18


def shifted(sqrt_price, bps):
    return int(sqrt_price * (1 + bps / 10_000) ** 0.5)


class GenericQuoteTest(unittest.TestCase):
    def test_round_trip_quoted_in_token0_loses_about_both_fees_at_equal_prices(self):
        pool = (SQRT, LIQUIDITY, 500)
        out = round_trip(pool, pool, WETH // 2, quote_is_token1=False)
        loss_bps = (WETH // 2 - out) / (WETH // 2) * 10_000
        self.assertGreater(loss_bps, 10.0)
        self.assertLess(loss_bps, 11.5)

    def test_round_trip_in_token0_buys_token1_on_the_first_pool(self):
        first, second = (SQRT, LIQUIDITY, 500), (shifted(SQRT, 30), LIQUIDITY, 500)
        token1_out, _ = token0_to_token1(first[0], first[1], WETH, first[2])
        expected, _ = token1_to_token0(second[0], second[1], token1_out, second[2])
        self.assertEqual(round_trip(first, second, WETH, quote_is_token1=False), expected)

    def test_gap_pays_in_one_direction_only_whichever_token_is_quoted(self):
        cheap, rich = (SQRT, LIQUIDITY, 100), (shifted(SQRT, 50), LIQUIDITY, 100)
        self.assertGreater(round_trip(cheap, rich, 1_000 * USDC, quote_is_token1=True), 1_000 * USDC)
        self.assertLess(round_trip(rich, cheap, 1_000 * USDC, quote_is_token1=True), 1_000 * USDC)
        self.assertGreater(round_trip(rich, cheap, WETH // 2, quote_is_token1=False), WETH // 2)
        self.assertLess(round_trip(cheap, rich, WETH // 2, quote_is_token1=False), WETH // 2)

    def test_spot_price_adjusts_for_decimals(self):
        self.assertAlmostEqual(spot_price(SQRT, 18, 6), 2017.7, delta=0.5)
        self.assertAlmostEqual(spot_price(Q96, 6, 6), 1.0)


class TickRangeTest(unittest.TestCase):
    def test_tick_at_matches_the_tick_reported_by_the_pool(self):
        self.assertEqual(tick_at(SQRT), TICK)

    def test_small_swap_stays_inside_the_current_spacing_range(self):
        _, new_sqrt = token1_to_token0(SQRT, LIQUIDITY, 10 * USDC, 500)
        self.assertTrue(stays_in_tick_range(TICK, new_sqrt, 10))

    def test_large_swap_leaves_the_current_spacing_range(self):
        _, new_sqrt = token1_to_token0(SQRT, LIQUIDITY, 10_000_000 * USDC, 500)
        self.assertFalse(stays_in_tick_range(TICK, new_sqrt, 10))


class ImpliedFeeTest(unittest.TestCase):
    def test_minimum_amounts_are_configurable(self):
        after = 3558722038844190121288233
        weth_in, usdc_out = 495676460000000000, -999604858
        self.assertEqual(replay.implied_fee_ppm(SQRT, after, LIQUIDITY, weth_in, usdc_out, 10 ** 7, 10 ** 7), 500)
        self.assertIsNone(replay.implied_fee_ppm(SQRT, after, LIQUIDITY, weth_in, usdc_out, 10 ** 18, 10 ** 18))


class PairConfigTest(unittest.TestCase):
    def test_every_pair_has_two_distinct_pools_and_a_unique_key(self):
        keys = [pair.key for pair in pairs.PAIRS]
        self.assertEqual(len(keys), len(set(keys)))
        for pair in pairs.PAIRS:
            a, b = pair.pools
            self.assertNotEqual(a.address.lower(), b.address.lower(), pair.key)
            self.assertNotEqual(a.name, b.name, pair.key)
            self.assertTrue(pair.inputs and pair.thresholds, pair.key)

    def test_reference_pair_matches_the_original_replay(self):
        reference = pairs.by_key("WETH-USDC")
        self.assertEqual(reference.swaps_path, "data/swaps.csv")
        self.assertEqual([p.name for p in reference.pools], ["univ3", "aero"])
        self.assertEqual(reference.pools[0].fee_ppm, 500)
        self.assertIsNone(reference.pools[1].fee_ppm)


class PairReportTest(unittest.TestCase):
    def test_single_range_share_is_reported_for_each_summary(self):
        pair = pairs.by_key("WETH-USDC")
        base, rich = SQRT, shifted(SQRT, 30)
        points = [replay.Point(0, 1, "0xa", base, LIQUIDITY, TICK, 500, base, LIQUIDITY, TICK, 150)]
        points += [replay.Point(t, t // 200 + 1, hex(t), base, LIQUIDITY, TICK, 500, rich, LIQUIDITY, TICK + 30, 150)
                   for t in range(200, 3200, 200)]
        points += [replay.Point(t, t // 200 + 1, hex(t), base, LIQUIDITY, TICK, 500, base, LIQUIDITY, TICK, 150)
                   for t in range(3200, 9000, 200)]
        summary, episodes = replay.summarize_pair(pair, points, 1_000 * USDC, 100_000)
        self.assertEqual(summary["episodes"], 1)
        self.assertEqual(summary["viable_2s"], 1)
        self.assertEqual(summary["single_range_pct"], 100.0)
        self.assertGreater(summary["viable_2s_surplus_total"], 0)


if __name__ == "__main__":
    unittest.main()
