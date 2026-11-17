"""Tests for the comparison driver and report. Run: python3 -m unittest discover -s tools -v"""
import unittest

import compare_driver as driver
import compare_report as report

POOL = (100 * 10 ** 18, 300_000 * 10 ** 6)
FEE_BPS = 30


def price_after(pool, side, amount):
    weth, usdc = pool
    after_fee = amount * (10_000 - FEE_BPS)
    if side == "usdc":
        weth_out = after_fee * weth // (usdc * 10_000 + after_fee)
        return (usdc + amount) / (weth - weth_out)
    usdc_out = after_fee * usdc // (weth * 10_000 + after_fee)
    return (usdc - usdc_out) / (weth + amount)


def gap_bps_after(pool_a, pool_b, side, amount):
    return (price_after(pool_b, side, amount) / (pool_a[1] / pool_a[0]) - 1) * 10_000


def log(enum_value):
    return {"data": "0x" + format(enum_value, "064x")}


class SwapForGapTest(unittest.TestCase):
    def test_pool_below_target_sells_usdc(self):
        side, amount = driver.swap_for_gap(POOL, POOL, 100)
        self.assertEqual(side, "usdc")
        self.assertAlmostEqual(gap_bps_after(POOL, POOL, side, amount), 100, delta=2)

    def test_pool_above_target_sells_weth_to_come_back_down(self):
        richer = (POOL[0], POOL[1] * 102 // 100)
        side, amount = driver.swap_for_gap(POOL, richer, 50)
        self.assertEqual(side, "weth")
        self.assertGreater(amount, 0)
        self.assertAlmostEqual(gap_bps_after(POOL, richer, side, amount), 50, delta=2)

    def test_pool_already_at_target_needs_no_swap(self):
        at_target = (POOL[0], POOL[1] * 101 // 100)
        self.assertEqual(driver.swap_for_gap(POOL, at_target, 100)[1], 0)


class ReportTest(unittest.TestCase):
    def test_counts_logs_by_enum_name(self):
        counts = report.count_by_name([log(0), log(6), log(6), log(5)], report.DECISIONS)
        self.assertEqual(counts, {"CallbackRequested": 1, "MarginBelowThreshold": 2, "ExecutorSwap": 1})

    def test_spent_combines_executor_balance_proxy_reserves_and_debt(self):
        before = {"lasna_funds_wei": 5 * 10 ** 17, "executor_eth_wei": 10 ** 14,
                  "executor_proxy_reserves_wei": 0, "executor_proxy_debt_wei": 0}
        after = {"lasna_funds_wei": 2 * 10 ** 17, "executor_eth_wei": 6 * 10 ** 13,
                 "executor_proxy_reserves_wei": 10 ** 13, "executor_proxy_debt_wei": 2 * 10 ** 13}
        costs = report.spent(before, after)
        self.assertAlmostEqual(costs["lreact"], 0.3)
        self.assertAlmostEqual(costs["eth_executor"], 0.00005)


if __name__ == "__main__":
    unittest.main()
