"""Comparison driver: runs the same workload on the filtered stack and the unfiltered stack.

Each round moves the Pool B price through a series of gaps against Pool A (ROUND_GAPS_BPS) with
real swaps from a throwaway trader. The first three gaps are below the surplus threshold, the last
one is above it. Each step is sent to both stacks before moving on to the next step.

The JSON output records the start/end blocks and the funds of each stack, for tools/compare_report.py.

Usage: python3 tools/compare_driver.py <round_count> <output_file.json> [--dry-run]
"""
from __future__ import annotations

import json
import math
import os
import sys
import time
from typing import Any, Dict, List, Tuple

import bench_trader as bench

ROUND_GAPS_BPS = (50, 100, 130, 200)
STEP_INTERVAL_S = 8.0  # let the callback (about 2 s) and react() on the executor's two swaps finish first
SETTLE_S = 20.0
CALLBACK_PROXY = "0x476F44b11F5C942c58f4c8E3d0300E5710743585"
Reserves = Tuple[int, int]


def swap_for_gap(pool_a: Reserves, pool_b: Reserves, gap_bps: int) -> Tuple[str, int]:
    """Swap on Pool B so its price is gap_bps above Pool A: ("usdc"|"weth", input token amount)."""
    usdc_in = bench.usdc_in_for_gap(pool_a, pool_b, gap_bps)
    if usdc_in > 0:
        return "usdc", usdc_in
    a_weth, a_usdc = pool_a
    b_weth, b_usdc = pool_b
    inverse_ratio_wad = a_weth * b_usdc * bench.BPS * bench.WAD // (a_usdc * b_weth * (bench.BPS + gap_bps))
    sqrt_wad = math.isqrt(inverse_ratio_wad * bench.WAD)
    return "weth", max(0, b_weth * (sqrt_wad - bench.WAD) // bench.WAD)


def stack_from_env(prefix: str) -> Dict[str, str]:
    return {name: os.environ[prefix + key] for name, key in
            (("pool_a", "POOL_A"), ("pool_b", "POOL_B"), ("executor", "EXECUTOR"), ("reactive", "REACTIVE"))}


def snapshot(stack: Dict[str, str]) -> Dict[str, int]:
    """Funds this stack can use up on both networks."""
    executor = stack["executor"]
    return {
        "lasna_funds_wei": bench.lasna_funds_wei(stack["reactive"]),
        "executor_eth_wei": int(bench.cast(["balance", executor, "--rpc-url", bench.BASE_RPC])),
        "executor_proxy_reserves_wei": bench.call_uint(
            bench.BASE_RPC, CALLBACK_PROXY, "reserves(address)(uint256)", executor)[0],
        "executor_proxy_debt_wei": bench.call_uint(
            bench.BASE_RPC, CALLBACK_PROXY, "debt(address)(uint256)", executor)[0],
    }


def block_numbers() -> Dict[str, int]:
    return {"base": int(bench.cast(["block-number", "--rpc-url", bench.BASE_RPC])),
            "lasna": int(bench.cast(["block-number", "--rpc-url", bench.LASNA_RPC]))}


def ensure_allowances(private_key: str, trader: str, tokens: List[str], pool: str) -> None:
    for token in tokens:
        allowance = bench.call_uint(bench.BASE_RPC, token, "allowance(address,address)(uint256)", trader, pool)[0]
        if allowance < bench.MAX_UINT256 // 2:
            bench.send(private_key, token, "approve(address,uint256)", pool, str(bench.MAX_UINT256))


def run_step(private_key: str, trader: str, tokens: Dict[str, str], stack: Dict[str, str],
             gap_bps: int, dry_run: bool) -> Dict[str, Any]:
    side, amount = swap_for_gap(bench.reserves(stack["pool_a"]), bench.reserves(stack["pool_b"]), gap_bps)
    step: Dict[str, Any] = {"gap_bps": gap_bps, "token_in": side, "amount_in": amount, "tx_hash": None}
    if amount > 0 and not dry_run:
        step["tx_hash"] = bench.send(private_key, stack["pool_b"], "swap(address,uint256,uint256,address)",
                                     tokens[side], str(amount), "0", trader)
    return step


def main() -> None:
    bench.load_env()
    rounds, out_path, dry_run = int(sys.argv[1]), sys.argv[2], "--dry-run" in sys.argv
    tokens = {"usdc": os.environ["USDC"], "weth": os.environ["WETH"]}
    trader = os.environ["TRADER"]
    # Stack names match the committed evidence files: berfilter = filtered, tanpa_filter = unfiltered.
    stacks = {"berfilter": stack_from_env(""), "tanpa_filter": stack_from_env("BASELINE_")}
    with open(bench.KEY_PATH) as handle:
        private_key = json.load(handle)[0]["private_key"]

    if not dry_run:
        for stack in stacks.values():
            ensure_allowances(private_key, trader, list(tokens.values()), stack["pool_b"])
    record: Dict[str, Any] = {
        "gaps_bps": ROUND_GAPS_BPS, "stacks": stacks, "start_blocks": block_numbers(),
        "before": {name: snapshot(stack) for name, stack in stacks.items()}, "steps": [],
    }
    for round_index in range(1, rounds + 1):
        low = [name for name, stack in stacks.items()
               if bench.lasna_funds_wei(stack["reactive"]) < bench.MIN_LASNA_FUNDS_WEI]
        if low:
            print(f"stopping before round {round_index}: low Lasna funds in {low}", flush=True)
            break
        for gap_bps in ROUND_GAPS_BPS:
            for name, stack in stacks.items():
                step = run_step(private_key, trader, tokens, stack, gap_bps, dry_run)
                record["steps"].append({"round": round_index, "stack": name, **step})
                print(f"round {round_index} {name} gap {gap_bps} bps: {step['token_in']} "
                      f"{step['amount_in']} tx {step['tx_hash']}", flush=True)
            if dry_run:
                return
            time.sleep(STEP_INTERVAL_S)

    time.sleep(SETTLE_S)
    record["end_blocks"] = block_numbers()
    record["after"] = {name: snapshot(stack) for name, stack in stacks.items()}
    with open(out_path, "w") as handle:
        handle.write(json.dumps(record, indent=1) + "\n")
    print("saved:", out_path, flush=True)


if __name__ == "__main__":
    main()
