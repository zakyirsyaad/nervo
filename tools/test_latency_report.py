"""Tests for the pure logic of the latency report. Run: python3 -m unittest discover -s tools -v"""
import unittest

import latency_report as report


def sample(latency_ms, outcome="Executed", origin_ts_ms=1_000_000):
    return {"latency_ms": latency_ms, "outcome": outcome if latency_ms is not None else None,
            "origin_ts_ms": origin_ts_ms}


class PercentileTest(unittest.TestCase):
    def test_empty_list_gives_none(self):
        self.assertIsNone(report.percentile([], 0.5))

    def test_nearest_rank_on_small_lists(self):
        self.assertEqual(report.percentile([1800, 1200], 0.50), 1200)
        self.assertEqual(report.percentile([1800, 1200], 0.95), 1800)
        self.assertEqual(report.percentile([5], 0.95), 5)

    def test_nearest_rank_on_hundred_values(self):
        values = list(range(1, 101))
        self.assertEqual(report.percentile(values, 0.50), 50)
        self.assertEqual(report.percentile(values, 0.95), 95)


class SummarizeTest(unittest.TestCase):
    def test_counts_arrivals_timeouts_and_pending(self):
        now_ms = 2_000_000
        samples = [sample(1200), sample(1800, "SkippedMarginGone"),
                   sample(None, origin_ts_ms=now_ms - 61_000),  # past the TTL: timeout
                   sample(None, origin_ts_ms=now_ms - 5_000)]   # still pending
        summary = report.summarize(samples, now_ms)
        self.assertEqual(summary["callback_diminta"], 4)
        self.assertEqual(summary["callback_tiba"], 2)
        self.assertEqual(summary["timeout"], 1)
        self.assertEqual(summary["menunggu"], 1)
        self.assertEqual((summary["p50_ms"], summary["p95_ms"]), (1200, 1800))
        self.assertEqual(summary["outcome"], {"Executed": 1, "SkippedMarginGone": 1})

    def test_no_samples(self):
        summary = report.summarize([], 0)
        self.assertEqual(summary["callback_diminta"], 0)
        self.assertIsNone(summary["p50_ms"])


class WordsTest(unittest.TestCase):
    def test_splits_data_into_32_byte_words(self):
        self.assertEqual(report.words("0x" + "00" * 31 + "05" + "00" * 31 + "ff"), [5, 255])


if __name__ == "__main__":
    unittest.main()
