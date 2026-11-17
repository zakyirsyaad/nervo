"""Tests for the trigger swap sizing. Run: python3 -m unittest discover -s tools -v"""
import unittest

import bench_trader as bench

POOL = (100 * 10 ** 18, 300_000 * 10 ** 6)


def price_after_usdc_in(pool, usdc_in, fee_bps=30):
    weth, usdc = pool
    in_after_fee = usdc_in * (10_000 - fee_bps)
    weth_out = in_after_fee * weth // (usdc * 10_000 + in_after_fee)
    return (usdc + usdc_in) / (weth - weth_out)


class UsdcInForGapTest(unittest.TestCase):
    def test_equal_pools_need_about_one_percent_of_reserve_for_two_percent_gap(self):
        amount = bench.usdc_in_for_gap(POOL, POOL, 200)
        self.assertAlmostEqual(amount / 1e6, 2_985.15, delta=0.5)
        gap = price_after_usdc_in(POOL, amount) / (POOL[1] / POOL[0]) - 1
        self.assertAlmostEqual(gap * 10_000, 200, delta=2)

    def test_pool_already_above_target_needs_nothing(self):
        richer = (POOL[0], POOL[1] * 103 // 100)
        self.assertEqual(bench.usdc_in_for_gap(POOL, richer, 200), 0)

    def test_partial_gap_needs_less(self):
        one_percent = (POOL[0], POOL[1] * 101 // 100)
        self.assertLess(bench.usdc_in_for_gap(POOL, one_percent, 200), bench.usdc_in_for_gap(POOL, POOL, 200))


if __name__ == "__main__":
    unittest.main()
