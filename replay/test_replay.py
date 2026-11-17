"""Tests for the quote math and the episode logic. Run: python3 -m unittest -v"""
import unittest

import replay
from quote import round_trip_usdc, usdc_to_weth, weth_to_usdc

# Two consecutive Uniswap V3 swaps from Base mainnet, blocks 55698123 and 55698124.
REAL_SQRT_BEFORE = 3558871971696076658134608
REAL_SQRT_AFTER = 3558722038844190121288233
REAL_LIQUIDITY = 528215498784700374
REAL_WETH_IN = 495676460000000000
REAL_USDC_OUT = 999604858
USDC = replay.USDC


REAL_TICK = -200223
PAIR = replay.REFERENCE


def make_point(ts_ms, block, uni_sqrt, aero_sqrt, tx="0x0"):
    return replay.Point(ts_ms, block, tx, uni_sqrt, REAL_LIQUIDITY, REAL_TICK, 500,
                        aero_sqrt, REAL_LIQUIDITY, REAL_TICK, 150)


def shifted(sqrt_price, bps):
    """Shifts the price by bps (the sqrt price shifts by half as much)."""
    return int(sqrt_price * (1 + bps / 10_000) ** 0.5)


class QuoteMathTest(unittest.TestCase):
    def test_weth_to_usdc_reproduces_real_mainnet_swap(self):
        usdc_out, new_sqrt = weth_to_usdc(REAL_SQRT_BEFORE, REAL_LIQUIDITY, REAL_WETH_IN, 500)
        self.assertAlmostEqual(usdc_out, REAL_USDC_OUT, delta=2)
        self.assertAlmostEqual(new_sqrt / REAL_SQRT_AFTER, 1.0, places=12)

    def test_implied_fee_of_real_swap_is_pool_fee(self):
        fee = replay.implied_fee_ppm(REAL_SQRT_BEFORE, REAL_SQRT_AFTER, REAL_LIQUIDITY, REAL_WETH_IN, -REAL_USDC_OUT)
        self.assertEqual(fee, 500)

    def test_buying_weth_raises_price_and_selling_lowers_it(self):
        _, up = usdc_to_weth(REAL_SQRT_BEFORE, REAL_LIQUIDITY, 1_000 * USDC, 500)
        _, down = weth_to_usdc(REAL_SQRT_BEFORE, REAL_LIQUIDITY, 10 ** 18, 500)
        self.assertGreater(up, REAL_SQRT_BEFORE)
        self.assertLess(down, REAL_SQRT_BEFORE)

    def test_round_trip_at_equal_prices_loses_about_both_fees(self):
        pool = (REAL_SQRT_BEFORE, REAL_LIQUIDITY, 500)
        out = round_trip_usdc(pool, pool, 1_000 * USDC)
        loss_bps = (1_000 * USDC - out) / (1_000 * USDC) * 10_000
        self.assertGreater(loss_bps, 10.0)   # two 5 bps fees
        self.assertLess(loss_bps, 11.5)      # plus a small price impact

    def test_higher_fee_gives_less_output(self):
        cheap, _ = usdc_to_weth(REAL_SQRT_BEFORE, REAL_LIQUIDITY, 1_000 * USDC, 100)
        costly, _ = usdc_to_weth(REAL_SQRT_BEFORE, REAL_LIQUIDITY, 1_000 * USDC, 500)
        self.assertGreater(cheap, costly)


class EpisodeTest(unittest.TestCase):
    def setUp(self):
        self.base = REAL_SQRT_BEFORE
        self.rich = shifted(self.base, 30)  # Aerodrome 30 bps more expensive

    def test_no_gap_means_no_episode(self):
        points = [make_point(t, t // 200, self.base, self.base) for t in range(0, 8000, 200)]
        episodes, candidates = replay.find_episodes(PAIR, points, 1_000 * USDC, 100_000)
        self.assertEqual((episodes, candidates), ([], 0))

    def test_gap_closed_in_same_block_does_not_survive(self):
        points = [make_point(0, 1, self.base, self.base, "0xa"),
                  make_point(200, 2, self.base, self.rich, "0xb"),
                  make_point(200, 2, self.base, self.base, "0xc")]
        points += [make_point(t, t // 200 + 1, self.base, self.base, hex(t)) for t in range(400, 8000, 200)]
        episodes, _ = replay.find_episodes(PAIR, points, 1_000 * USDC, 100_000)
        self.assertEqual(len(episodes), 1)
        self.assertEqual(episodes[0]["direction"], replay.A_THEN_B)  # buy WETH on Uniswap, sell on Aerodrome
        self.assertEqual(episodes[0]["duration_ms"], 0)
        self.assertTrue(all(value < 100_000 for value in episodes[0]["later"].values()))

    def test_persistent_gap_survives_two_seconds_but_not_five(self):
        points = [make_point(0, 1, self.base, self.base, "0xa")]
        points += [make_point(t, t // 200 + 1, self.base, self.rich, hex(t)) for t in range(200, 3200, 200)]
        points += [make_point(t, t // 200 + 1, self.base, self.base, hex(t)) for t in range(3200, 9000, 200)]
        episodes, _ = replay.find_episodes(PAIR, points, 1_000 * USDC, 100_000)
        self.assertEqual(len(episodes), 1)
        later = episodes[0]["later"]
        self.assertGreaterEqual(later[1000], 100_000)
        self.assertGreaterEqual(later[2000], 100_000)
        self.assertLess(later[5000], 100_000)
        self.assertEqual(episodes[0]["duration_ms"], 3000)

    def test_signal_too_close_to_end_of_data_is_excluded(self):
        points = [make_point(0, 1, self.base, self.base, "0xa"), make_point(200, 2, self.base, self.rich, "0xb")]
        episodes, candidates = replay.find_episodes(PAIR, points, 1_000 * USDC, 100_000)
        self.assertEqual((len(episodes), candidates), (0, 1))

    def test_block_end_points_keep_last_state_per_block(self):
        points = [make_point(0, 1, self.base, self.rich, "0xa"), make_point(0, 1, self.base, self.base, "0xb"),
                  make_point(200, 2, self.base, self.base, "0xc")]
        self.assertEqual([p.tx_hash for p in replay.block_end_points(points)], ["0xb", "0xc"])

    def test_duration_buckets(self):
        episodes = [{"duration_ms": d} for d in (0, 0, 200, 800, 4000, 9000)]
        self.assertEqual(replay.duration_buckets(episodes),
                         {"blok_sama": 2, "satu_blok_200ms": 1, "sampai_1s": 1, "sampai_5s": 1, "lebih_5s": 1})


if __name__ == "__main__":
    unittest.main()
