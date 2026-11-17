"""Benchmark driver: sends spaced-out trigger swaps from a throwaway trader.

Each sample is one USDC -> WETH swap on Pool B that opens a price gap against Pool A.
The next swap is sized only after a pause, from the actual reserves, so the executor's arbitrage
from the previous sample is already reflected. The driver stops before the Reactive contract
runs out of Lasna funds.

Usage: python3 tools/bench_trader.py <sample_count> [--dry-run]
Addresses are read from .env; the trader key from .bench-trader.json.
"""
from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import time
from typing import List, Tuple

BASE_RPC = os.environ.get("BASE_SEPOLIA_RPC_URL", "https://base-sepolia-rpc.publicnode.com")
LASNA_RPC = os.environ.get("LASNA_RPC_URL", "https://lasna-rpc.rnk.dev/")
SYSTEM_CONTRACT = "0x8888888888888888888888888888888888888888"
KEY_PATH = ".bench-trader.json"
GAP_BPS = 200  # Pool B 2% above Pool A: surplus of about 7 USDC per 1,000 USDC
BPS = 10_000
WAD = 10 ** 18
SAMPLE_INTERVAL_S = 6.0  # give the callback and the react() calls for the executor's two swaps time to finish
MIN_LASNA_FUNDS_WEI = 7 * 10 ** 16  # stop below 0.07 lREACT so the contract does not go into debt
MAX_UINT256 = 2 ** 256 - 1


def load_env(path: str = ".env") -> None:
    with open(path) as handle:
        for line in handle:
            key, sep, value = line.strip().partition("=")
            if sep and not key.startswith("#"):
                os.environ.setdefault(key, value)


def cast(args: List[str]) -> str:
    result = subprocess.run(["cast", *args], capture_output=True, text=True, timeout=90)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip().splitlines()[-1] if result.stderr.strip() else "cast failed")
    return result.stdout.strip()


def call_uint(rpc_url: str, target: str, signature: str, *args: str) -> List[int]:
    output = cast(["call", target, signature, *args, "--rpc-url", rpc_url])
    return [int(line.split()[0]) for line in output.splitlines()]


def reserves(pool: str) -> Tuple[int, int]:
    weth, usdc = call_uint(BASE_RPC, pool, "getReserves()(uint256,uint256)")
    return weth, usdc


def usdc_in_for_gap(pool_a: Tuple[int, int], pool_b: Tuple[int, int], gap_bps: int) -> int:
    """USDC to sell into Pool B so its price is gap_bps above Pool A. Zero if it is already above."""
    a_weth, a_usdc = pool_a
    b_weth, b_usdc = pool_b
    ratio_wad = a_usdc * b_weth * (BPS + gap_bps) * WAD // (a_weth * b_usdc * BPS)
    sqrt_ratio_wad = math.isqrt(ratio_wad * WAD)
    return max(0, b_usdc * (sqrt_ratio_wad - WAD) // WAD)


def lasna_funds_wei(reactive: str) -> int:
    reserve = call_uint(LASNA_RPC, SYSTEM_CONTRACT, "reserves(address)(uint256)", reactive)[0]
    debt = call_uint(LASNA_RPC, SYSTEM_CONTRACT, "debt(address)(uint256)", reactive)[0]
    balance = int(cast(["balance", reactive, "--rpc-url", LASNA_RPC]))
    return reserve + balance - debt


def send(private_key: str, target: str, signature: str, *args: str) -> str:
    output = cast(["send", target, signature, *args, "--rpc-url", BASE_RPC,
                   "--private-key", private_key, "--json"])
    receipt = json.loads(output)
    if int(receipt["status"], 16) != 1:
        raise RuntimeError(f"transaction failed: {receipt['transactionHash']}")
    return receipt["transactionHash"]


def main() -> None:
    load_env()
    sample_count = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    dry_run = "--dry-run" in sys.argv
    pool_a, pool_b = os.environ["POOL_A"], os.environ["POOL_B"]
    usdc, reactive, trader = os.environ["USDC"], os.environ["REACTIVE"], os.environ["TRADER"]
    with open(KEY_PATH) as handle:
        private_key = json.load(handle)[0]["private_key"]

    if not dry_run:
        allowance = call_uint(BASE_RPC, usdc, "allowance(address,address)(uint256)", trader, pool_b)[0]
        if allowance < MAX_UINT256 // 2:
            print("approve:", send(private_key, usdc, "approve(address,uint256)", pool_b, str(MAX_UINT256)), flush=True)

    for index in range(1, sample_count + 1):
        funds = lasna_funds_wei(reactive)
        if funds < MIN_LASNA_FUNDS_WEI:
            print(f"stopping: Lasna funds {funds / WAD:.4f} lREACT below the limit", flush=True)
            break
        amount = usdc_in_for_gap(reserves(pool_a), reserves(pool_b), GAP_BPS)
        if amount == 0:
            print(f"sample {index}: gap already above target, skipped", flush=True)
        elif dry_run:
            print(f"sample {index}: would swap {amount / 1e6:.2f} USDC (Lasna funds {funds / WAD:.4f})", flush=True)
            break
        else:
            tx_hash = send(private_key, pool_b, "swap(address,uint256,uint256,address)", usdc, str(amount), "0", trader)
            print(f"sample {index}: swap {amount / 1e6:.2f} USDC tx {tx_hash} (Lasna funds {funds / WAD:.4f})", flush=True)
        time.sleep(SAMPLE_INTERVAL_S)


if __name__ == "__main__":
    main()
