"""Comparison report: filtered stack versus unfiltered stack for the same workload.

Reads the record from tools/compare_driver.py, then computes from chain data in that block range:
decisions on Lasna, callback outcomes on Base Sepolia, callback latency, and funds spent.

Usage: python3 tools/compare_report.py <driver_record.json> [output_file.json]
"""
from __future__ import annotations

import json
import sys
from typing import Any, Dict, List

import latency_report as lat

DECISIONS = ("CallbackRequested", "UnknownSource", "StaleOrDuplicateLog", "SnapshotIncomplete",
             "SnapshotStale", "ExecutorSwap", "MarginBelowThreshold")
WAD = 10 ** 18


def fetch_range(url: str, address: str, topic: str, start: int, end: int, chunk: int) -> List[Dict[str, Any]]:
    logs: List[Dict[str, Any]] = []
    for begin in range(start, end + 1, chunk):
        logs.extend(lat.rpc(url, "eth_getLogs", [{
            "fromBlock": hex(begin), "toBlock": hex(min(begin + chunk - 1, end)),
            "address": address, "topics": [topic]}]))
    return logs


def count_by_name(logs: List[Dict[str, Any]], names: tuple) -> Dict[str, int]:
    """Counts logs by the enum value in the first data word."""
    counts: Dict[str, int] = {}
    for log in logs:
        name = names[lat.words(log["data"])[0]]
        counts[name] = counts.get(name, 0) + 1
    return counts


def spent(before: Dict[str, int], after: Dict[str, int]) -> Dict[str, float]:
    """Funds spent: lREACT on Lasna and executor ETH on Base Sepolia (balance + proxy reserves - debt)."""
    def base_funds(s: Dict[str, int]) -> int:
        return s["executor_eth_wei"] + s["executor_proxy_reserves_wei"] - s["executor_proxy_debt_wei"]
    return {"lreact": (before["lasna_funds_wei"] - after["lasna_funds_wei"]) / WAD,
            "eth_executor": (base_funds(before) - base_funds(after)) / WAD}


def stack_report(decisions: List[Dict[str, Any]], outcomes: List[Dict[str, Any]],
                 before: Dict[str, int], after: Dict[str, int], now_ms: int) -> Dict[str, Any]:
    decision_counts = count_by_name(decisions, DECISIONS)
    outcome_counts = count_by_name(outcomes, lat.OUTCOMES)
    requested = decision_counts.get("CallbackRequested", 0)
    executed = outcome_counts.get("Executed", 0)
    costs = spent(before, after)
    latency = lat.summarize(lat.build_samples(decisions, outcomes), now_ms)
    # Keys match the committed evidence files: log_diproses = logs processed, keputusan = decisions,
    # callback_diminta/terbuang = callbacks requested/wasted, terpakai = spent, eksekusi = execution.
    return {
        "log_diproses": len(decisions),
        "keputusan": decision_counts,
        "outcome": outcome_counts,
        "callback_diminta": requested,
        "callback_terbuang": requested - executed,
        "terpakai": costs,
        "lreact_per_eksekusi": costs["lreact"] / executed if executed else None,
        "latensi": {key: latency[key] for key in ("callback_tiba", "timeout", "p50_ms", "p95_ms")},
    }


def main() -> None:
    lat.load_env()
    with open(sys.argv[1]) as handle:
        record = json.load(handle)
    start, end = record["start_blocks"], record["end_blocks"]
    now_ms = lat.block_timestamp_ms(end["base"], {})
    # rentang_blok = block range (awal/akhir = start/end), selisih_bps = gaps, langkah = steps per stack.
    report: Dict[str, Any] = {"rentang_blok": {"awal": start, "akhir": end}, "selisih_bps": record["gaps_bps"],
                              "langkah": len(record["steps"]) // len(record["stacks"])}
    for name, stack in record["stacks"].items():
        decisions = fetch_range(lat.LASNA_RPC, stack["reactive"], lat.DECISION_TOPIC,
                                start["lasna"], end["lasna"], lat.LASNA_CHUNK_BLOCKS)
        outcomes = fetch_range(lat.BASE_RPC, stack["executor"], lat.OUTCOME_TOPIC,
                               start["base"], end["base"], lat.BASE_CHUNK_BLOCKS)
        report[name] = stack_report(decisions, outcomes, record["before"][name], record["after"][name], now_ms)
    text = json.dumps(report, indent=1)
    if len(sys.argv) > 2:
        with open(sys.argv[2], "w") as handle:
            handle.write(text + "\n")
    print(text)


if __name__ == "__main__":
    main()
