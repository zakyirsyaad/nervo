"""Tests for the order benchmark's sizing and reporting. Run: python3 -m unittest discover -s tools -v"""
import unittest

import order_bench as bench

POOL = (100 * 10 ** 18, 330_000 * 10 ** 6)  # 3,300 USDC per WETH


class PoolMathTest(unittest.TestCase):
    def test_price_is_usdc_base_units_per_whole_weth(self):
        self.assertEqual(bench.price(POOL), 3_300 * 10 ** 6)

    def test_selling_weth_moves_the_price_down_to_the_target(self):
        target = bench.price(POOL) * (10_000 - 60) // 10_000
        weth_in = bench.weth_in_for_price(POOL, target)

        after = bench.reserves_after(POOL, weth_in, weth_in_side=True)

        self.assertLessEqual(bench.price(after), target)
        self.assertGreater(bench.price(after), target * 9_990 // 10_000)

    def test_buying_weth_moves_the_price_back_up(self):
        lowered = bench.reserves_after(POOL, 3 * 10 ** 17, weth_in_side=True)
        usdc_in = bench.usdc_in_for_price(lowered, bench.price(POOL))

        restored = bench.reserves_after(lowered, usdc_in, weth_in_side=False)

        self.assertGreaterEqual(bench.price(restored), bench.price(POOL))
        self.assertLess(bench.price(restored), bench.price(POOL) * 10_010 // 10_000)

    def test_no_trade_is_needed_when_the_price_is_already_there(self):
        self.assertEqual(bench.weth_in_for_price(POOL, bench.price(POOL) + 1), 0)
        self.assertEqual(bench.usdc_in_for_price(POOL, bench.price(POOL) - 1), 0)


class OrderSizingTest(unittest.TestCase):
    def test_trigger_sits_below_the_current_price(self):
        self.assertEqual(bench.trigger_price(3_300 * 10 ** 6, 40), 3_286_800_000)

    def test_min_out_leaves_room_for_the_execution_pool(self):
        min_out = bench.min_amount_out(10 ** 17, 3_300 * 10 ** 6, 300)
        self.assertEqual(min_out, 320_100_000)  # 0.1 WETH at 3,300 less 3%


class SummaryTest(unittest.TestCase):
    def test_summary_counts_fills_and_latency_percentiles(self):
        samples = [{"outcome": "Filled", "latency_ms": ms} for ms in (1_800, 2_800, 1_800, 3_800)]
        samples.append({"outcome": "Timeout", "latency_ms": None})

        summary = bench.summarize(samples)

        self.assertEqual(summary["samples"], 5)
        self.assertEqual(summary["filled"], 4)
        self.assertEqual(summary["p50_ms"], 1_800)
        self.assertEqual(summary["max_ms"], 3_800)

    def test_summary_of_nothing_has_no_latency(self):
        self.assertIsNone(bench.summarize([])["p50_ms"])


if __name__ == "__main__":
    unittest.main()
