"""Latency report for the origin -> Lasna -> destination loop, from chain data.

Each CallbackRequested decision on Lasna is paired with an ArbOutcome on Base Sepolia by
opportunity ID. Latency = blockTimestampMs of the callback block - blockTimestampMs of the trigger tx block.
Both blocks are on Base Sepolia, so the numbers come from block timestamps on a single network, with
a resolution of one block (200 ms). Lasna block timestamps are not used because they are not comparable.

Usage: python3 tools/latency_report.py [output_file.json]
Addresses are read from the environment or .env: EXECUTOR, REACTIVE.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from typing import Any, Dict, List, Optional

BASE_RPC = os.environ.get("BASE_SEPOLIA_RPC_URL", "https://base-sepolia-rpc.publicnode.com")
LASNA_RPC = os.environ.get("LASNA_RPC_URL", "https://lasna-rpc.rnk.dev/")
BASE_START_BLOCK = 59_086_000  # before the 15 November 2026 deploy
LASNA_START_BLOCK = 8_402_000
BASE_CHUNK_BLOCKS = 10_000
LASNA_CHUNK_BLOCKS = 400
REQUEST_TIMEOUT_S = 60
MAX_RETRIES = 5
CALLBACK_TIMEOUT_MS = 60_000  # same as the contract's CALLBACK_TTL

DECISION_TOPIC = "0x63c7fe3aff8526d74db76689a0432840776f1c26e3ccab419b647f14ec64ce16"
OUTCOME_TOPIC = "0x2a4669c149e459748526d060f6adaf92fe69f08b8682a3e1e328e8cddc355837"
DECISION_CALLBACK_REQUESTED = 0
OUTCOMES = ("Executed", "SkippedAlreadyExecuted", "SkippedExpired", "SkippedInvalidRoute",
            "SkippedInputOutOfBounds", "SkippedMarginGone", "SkippedInsufficientInventory", "SwapReverted")


def load_env(path: str = ".env") -> None:
    if not os.path.exists(path):
        return
    with open(path) as handle:
        for line in handle:
            key, sep, value = line.strip().partition("=")
            if sep and not key.startswith("#"):
                os.environ.setdefault(key, value)


def rpc(url: str, method: str, params: List[Any]) -> Any:
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = urllib.request.Request(
        url, data=body, headers={"content-type": "application/json", "user-agent": "latency-report/0.1"})
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_S) as response:
                reply = json.load(response)
            if "error" in reply:
                raise RuntimeError(reply["error"])
            return reply["result"]
        except Exception as error:
            if attempt == MAX_RETRIES - 1:
                raise
            print(f"  retry {method}: {error}", file=sys.stderr)
            time.sleep(2 ** attempt)


def fetch_logs(url: str, address: str, topic: str, start: int, chunk: int) -> List[Dict[str, Any]]:
    latest = int(rpc(url, "eth_blockNumber", []), 16)
    logs: List[Dict[str, Any]] = []
    for begin in range(start, latest + 1, chunk):
        end = min(begin + chunk - 1, latest)
        logs.extend(rpc(url, "eth_getLogs", [{
            "fromBlock": hex(begin), "toBlock": hex(end), "address": address, "topics": [topic]}]))
    return logs


def words(data_hex: str) -> List[int]:
    data = data_hex[2:]
    return [int(data[i:i + 64], 16) for i in range(0, len(data), 64)]


def block_timestamp_ms(block_number: int, cache: Dict[int, int]) -> int:
    if block_number not in cache:
        block = rpc(BASE_RPC, "eth_getBlockByNumber", [hex(block_number), False])
        cache[block_number] = int(block["timestampMs"], 16)
    return cache[block_number]


def percentile(values: List[int], fraction: float) -> Optional[int]:
    """Nearest-rank percentile; None for an empty list."""
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, -(-len(ordered) * fraction // 1))  # round up
    return ordered[int(rank) - 1]


def build_samples(decisions: List[Dict[str, Any]], outcomes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Pairs each CallbackRequested with the first outcome that has the same ID."""
    first_outcome: Dict[str, Dict[str, Any]] = {}
    for log in outcomes:
        first_outcome.setdefault(log["topics"][1], log)

    cache: Dict[int, int] = {}
    samples: List[Dict[str, Any]] = []
    for log in decisions:
        values = words(log["data"])
        if values[0] != DECISION_CALLBACK_REQUESTED:
            continue
        opportunity_id = log["topics"][1]
        origin_tx_hash = "0x" + format(values[1], "064x")
        receipt = rpc(BASE_RPC, "eth_getTransactionReceipt", [origin_tx_hash])
        origin_block = int(receipt["blockNumber"], 16)
        sample: Dict[str, Any] = {
            "opportunity_id": opportunity_id,
            "origin_tx_hash": origin_tx_hash,
            "origin_block": origin_block,
            "origin_ts_ms": block_timestamp_ms(origin_block, cache),
            "lasna_tx_hash": log["transactionHash"],
            "lasna_block": int(log["blockNumber"], 16),
            "quoted_out": values[5],
            "callback_tx_hash": None, "callback_block": None, "outcome": None, "latency_ms": None,
        }
        outcome = first_outcome.get(opportunity_id)
        if outcome is not None:
            callback_block = int(outcome["blockNumber"], 16)
            sample.update(
                callback_tx_hash=outcome["transactionHash"], callback_block=callback_block,
                outcome=OUTCOMES[words(outcome["data"])[0]],
                latency_ms=block_timestamp_ms(callback_block, cache) - sample["origin_ts_ms"])
        samples.append(sample)
    return samples


def summarize(samples: List[Dict[str, Any]], now_ms: int) -> Dict[str, Any]:
    latencies = [s["latency_ms"] for s in samples if s["latency_ms"] is not None]
    pending = [s for s in samples if s["latency_ms"] is None]
    timeouts = sum(1 for s in pending if now_ms - s["origin_ts_ms"] > CALLBACK_TIMEOUT_MS)
    outcome_counts: Dict[str, int] = {}
    for sample in samples:
        if sample["outcome"]:
            outcome_counts[sample["outcome"]] = outcome_counts.get(sample["outcome"], 0) + 1
    # Keys match the committed evidence files: sumber_waktu = time source (block timestamp, 200 ms
    # resolution), callback_diminta/tiba = callbacks requested/arrived, menunggu = pending, maks = max.
    return {
        "sumber_waktu": "blockTimestampMs Base Sepolia (timestamp blok, resolusi 200 ms)",
        "callback_diminta": len(samples),
        "callback_tiba": len(latencies),
        "timeout": timeouts,
        "menunggu": len(pending) - timeouts,
        "p50_ms": percentile(latencies, 0.50),
        "p95_ms": percentile(latencies, 0.95),
        "min_ms": min(latencies) if latencies else None,
        "maks_ms": max(latencies) if latencies else None,
        "outcome": outcome_counts,
    }


def main() -> None:
    load_env()
    decisions = fetch_logs(LASNA_RPC, os.environ["REACTIVE"], DECISION_TOPIC, LASNA_START_BLOCK, LASNA_CHUNK_BLOCKS)
    outcomes = fetch_logs(BASE_RPC, os.environ["EXECUTOR"], OUTCOME_TOPIC, BASE_START_BLOCK, BASE_CHUNK_BLOCKS)
    samples = build_samples(decisions, outcomes)
    # ringkasan = summary, sampel = samples (keys match the committed evidence files).
    report = {"ringkasan": summarize(samples, int(time.time() * 1000)), "sampel": samples}
    text = json.dumps(report, indent=1)
    if len(sys.argv) > 1:
        with open(sys.argv[1], "w") as handle:
            handle.write(text + "\n")
    print(json.dumps(report["ringkasan"], indent=1))
    for sample in samples:
        print(f'{sample["origin_block"]} -> {sample["callback_block"]}  '
              f'{sample["latency_ms"]} ms  {sample["outcome"]}')


if __name__ == "__main__":
    main()
