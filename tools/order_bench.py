"""Benchmark driver for protective orders: trigger-to-fill latency across Base Sepolia and Unichain Sepolia.

Each sample, from a throwaway trader:
1. places a 0.1 WETH stop-loss on Unichain Sepolia, 0.4% below the current Base Pool A price;
2. waits until OrderReactive on Lasna has mirrored it;
3. sells WETH on Base Pool A until its price is 0.6% lower, which crosses the trigger;
4. waits for the OrderOutcome on Unichain Sepolia;
5. buys WETH back on Pool A to restore the starting price.
A 0.6% gap between Pool A and Pool B stays below the arbitrage threshold, so the arbitrage loop does
not trade during the benchmark if the pools start aligned.

Latency = timestamp of the Unichain block that filled the order - blockTimestampMs of the Base block
whose swap crossed the trigger. Unichain block timestamps are whole seconds, so each value can be up to
one second shorter than the true delay.

Usage: python3 tools/order_bench.py <samples> [output.json]
The trader key is read from .bench-trader.json and never printed.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

BASE_RPC = "https://sepolia.base.org"
UNICHAIN_RPC = "https://sepolia.unichain.org"
LASNA_RPC = "https://lasna-rpc.rnk.dev/"
SYSTEM_CONTRACT = "0x8888888888888888888888888888888888888888"
KEY_PATH = ".bench-trader.json"

POOL_A = "0x82DEA86F73edF0CC76cd2Ff4Ae8612380e63CE6F"
BASE_WETH = "0x29583A3d63FD02f1bE462d4b6A1B1BeCeFcaFB87"
BASE_USDC = "0xb790467931Ad6694747bB90c96ac9b07c0c4DE01"
ORDER_BOOK = "0x20eBb811ecD7198cAbB2D9293Ab13B94097DFe5b"
UNICHAIN_WETH = "0x0f70a79D1a0DFCB61005AF03084d3bED0e71E932"
UNICHAIN_POOL = "0xb790467931Ad6694747bB90c96ac9b07c0c4DE01"
UNICHAIN_FAUCET = "0xc02a210DC8d74118205100Bb3744ed09d522fFCf"
ORDER_REACTIVE = "0xc02a210DC8d74118205100Bb3744ed09d522fFCf"

ORDER_WETH = 10 ** 17
ORDER_FEE_WEI = 10 ** 14
TRIGGER_BELOW_BPS = 40
DROP_BPS = 60
MIN_OUT_SLACK_BPS = 300
FEE_BPS = 30
BPS = 10_000
WAD = 10 ** 18
MAX_UINT256 = 2 ** 256 - 1
ORDER_LIFETIME_S = 3_600
WAIT_TIMEOUT_S = 120
POLL_S = 1.0
PAUSE_BETWEEN_SAMPLES_S = 8.0
MIN_LASNA_FUNDS_WEI = 2 * 10 ** 17
OUTCOMES = ("Filled", "SkippedNotOpen", "SkippedExpired", "SkippedSlippage")

Reserves = Tuple[int, int]


# --- pool math (mirrors src/libraries/ArbMath.sol and ConstantProductPool) ---

def price(reserves: Reserves) -> int:
    """USDC base units per one whole WETH."""
    weth, usdc = reserves
    return usdc * WAD // weth


def amount_out(amount_in: int, reserve_in: int, reserve_out: int) -> int:
    after_fee = amount_in * (BPS - FEE_BPS)
    return after_fee * reserve_out // (reserve_in * BPS + after_fee)


def reserves_after(reserves: Reserves, amount_in: int, weth_in_side: bool) -> Reserves:
    weth, usdc = reserves
    if weth_in_side:
        return weth + amount_in, usdc - amount_out(amount_in, weth, usdc)
    return weth - amount_out(amount_in, usdc, weth), usdc + amount_in


def _smallest_input(reserves: Reserves, reached, weth_in_side: bool, upper: int) -> int:
    """Smallest input whose resulting reserves satisfy `reached`, by binary search."""
    low, high = 0, upper
    while low < high:
        middle = (low + high) // 2
        if reached(reserves_after(reserves, middle, weth_in_side)):
            high = middle
        else:
            low = middle + 1
    return low


def weth_in_for_price(reserves: Reserves, target: int) -> int:
    """WETH to sell so the price ends at or below target. Zero if it already is."""
    if price(reserves) <= target:
        return 0
    return _smallest_input(reserves, lambda after: price(after) <= target, True, reserves[0])


def usdc_in_for_price(reserves: Reserves, target: int) -> int:
    """USDC to spend so the price ends at or above target. Zero if it already is."""
    if price(reserves) >= target:
        return 0
    return _smallest_input(reserves, lambda after: price(after) >= target, False, reserves[1])


def trigger_price(current: int, below_bps: int) -> int:
    return current * (BPS - below_bps) // BPS


def min_amount_out(weth_in: int, execution_price: int, slack_bps: int) -> int:
    return weth_in * execution_price // WAD * (BPS - slack_bps) // BPS


# --- reporting ---

def percentile(values: List[int], fraction: float) -> Optional[int]:
    """Nearest-rank percentile, the same method as latency_report.py."""
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, -(-len(ordered) * fraction // 1))
    return ordered[int(rank) - 1]


def summarize(samples: List[Dict[str, Any]]) -> Dict[str, Any]:
    latencies = [s["latency_ms"] for s in samples if s.get("outcome") == "Filled" and s.get("latency_ms") is not None]
    return {
        "samples": len(samples),
        "filled": sum(1 for s in samples if s.get("outcome") == "Filled"),
        "p50_ms": percentile(latencies, 0.5),
        "p95_ms": percentile(latencies, 0.95),
        "min_ms": min(latencies) if latencies else None,
        "max_ms": max(latencies) if latencies else None,
        "time_source": "Base Sepolia blockTimestampMs (200 ms) to Unichain Sepolia block timestamp (whole seconds)",
    }


# --- chain access ---

def rpc(url: str, method: str, params: List[Any]) -> Any:
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = urllib.request.Request(url, data=body, headers={"content-type": "application/json",
                                                              "user-agent": "order-bench/0.1"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                reply = json.load(response)
            if "error" in reply:
                raise RuntimeError(reply["error"])
            return reply["result"]
        except Exception:  # rate limit or network error: retry with backoff
            if attempt == 4:
                raise
            time.sleep(2 * (attempt + 1))


def cast(args: List[str]) -> str:
    result = subprocess.run(["cast", *args], capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        # Never echo the command: it contains the private key.
        raise RuntimeError(result.stderr.strip().splitlines()[-1] if result.stderr.strip() else "cast failed")
    return result.stdout.strip()


def topic(signature: str) -> str:
    return cast(["keccak", signature])


def send(key: str, rpc_url: str, target: str, signature: str, *args: str, value: Optional[int] = None) -> Dict:
    extra = ["--value", str(value)] if value else []
    receipt = json.loads(cast(["send", target, signature, *args, *extra, "--rpc-url", rpc_url,
                               "--private-key", key, "--json"]))
    if int(receipt["status"], 16) != 1:
        raise RuntimeError(f"transaction failed: {receipt['transactionHash']}")
    return receipt


def call_uint(rpc_url: str, target: str, signature: str, *args: str) -> List[int]:
    output = cast(["call", target, signature, *args, "--rpc-url", rpc_url])
    return [int(line.split()[0]) for line in output.splitlines()]


def pool_reserves(rpc_url: str, pool: str) -> Reserves:
    weth, usdc = call_uint(rpc_url, pool, "getReserves()(uint256,uint256)")
    return weth, usdc


def block_ts_ms(rpc_url: str, block: int) -> int:
    header = rpc(rpc_url, "eth_getBlockByNumber", [hex(block), False])
    if header.get("timestampMs"):
        return int(header["timestampMs"], 16)
    return int(header["timestamp"], 16) * 1000


def lasna_funds_wei(reactive: str) -> int:
    reserve = call_uint(LASNA_RPC, SYSTEM_CONTRACT, "reserves(address)(uint256)", reactive)[0]
    debt = call_uint(LASNA_RPC, SYSTEM_CONTRACT, "debt(address)(uint256)", reactive)[0]
    return reserve + int(cast(["balance", reactive, "--rpc-url", LASNA_RPC])) - debt


def wait_for_log(rpc_url: str, address: str, topics: List[str], from_block: int, max_range: int) -> Optional[Dict]:
    """Polls for the first log matching topics until WAIT_TIMEOUT_S passes."""
    deadline = time.time() + WAIT_TIMEOUT_S
    while time.time() < deadline:
        head = int(rpc(rpc_url, "eth_blockNumber", []), 16)
        start = max(from_block, head - max_range + 1)
        logs = rpc(rpc_url, "eth_getLogs", [{"fromBlock": hex(start), "toBlock": hex(head),
                                              "address": address, "topics": topics}])
        if logs:
            return logs[0]
        time.sleep(POLL_S)
    return None


def id_topic(order_id: int) -> str:
    return "0x" + format(order_id, "064x")


# --- one sample ---

def run_sample(key: str, trader: str, t: Dict[str, str]) -> Dict[str, Any]:
    start_price = price(pool_reserves(BASE_RPC, POOL_A))
    execution_price = price(pool_reserves(UNICHAIN_RPC, UNICHAIN_POOL))
    trigger = trigger_price(start_price, TRIGGER_BELOW_BPS)
    expiry = int(time.time()) + ORDER_LIFETIME_S
    lasna_from = int(rpc(LASNA_RPC, "eth_blockNumber", []), 16)

    placed = send(key, UNICHAIN_RPC, ORDER_BOOK,
                  "placeOrder(address,uint256,uint8,uint256,uint256,uint64)",
                  UNICHAIN_WETH, str(ORDER_WETH), "0", str(trigger),
                  str(min_amount_out(ORDER_WETH, execution_price, MIN_OUT_SLACK_BPS)), str(expiry),
                  value=ORDER_FEE_WEI)
    placed_log = next(log for log in placed["logs"] if log["topics"][0] == t["placed"])
    order_id = int(placed_log["topics"][1], 16)
    place_block = int(placed["blockNumber"], 16)
    sample: Dict[str, Any] = {"order_id": order_id, "start_price": start_price, "trigger_price": trigger,
                              "place_tx": placed["transactionHash"], "place_block": place_block}

    mirrored = wait_for_log(LASNA_RPC, ORDER_REACTIVE, [t["mirrored"], id_topic(order_id)], lasna_from, 30_000)
    if mirrored is None:
        sample["outcome"] = "NotMirrored"
        return sample
    sample["mirror_tx"] = mirrored["transactionHash"]

    weth_in = weth_in_for_price(pool_reserves(BASE_RPC, POOL_A), trigger_price(start_price, DROP_BPS))
    drop = send(key, BASE_RPC, POOL_A, "swap(address,uint256,uint256,address)", BASE_WETH, str(weth_in), "0", trader)
    drop_block = int(drop["blockNumber"], 16)
    sample.update({"drop_tx": drop["transactionHash"], "drop_block": drop_block,
                   "drop_ts_ms": block_ts_ms(BASE_RPC, drop_block)})

    outcome = wait_for_log(UNICHAIN_RPC, ORDER_BOOK, [t["outcome"], id_topic(order_id)], place_block, 1_000)
    triggered = wait_for_log(LASNA_RPC, ORDER_REACTIVE, [t["triggered"], id_topic(order_id)], lasna_from, 30_000)
    if triggered:
        sample["trigger_tx"] = triggered["transactionHash"]
    if outcome is None:
        sample.update({"outcome": "Timeout", "latency_ms": None})
    else:
        fill_block = int(outcome["blockNumber"], 16)
        data = outcome["data"][2:]
        fill_ts_ms = block_ts_ms(UNICHAIN_RPC, fill_block)
        sample.update({
            "outcome": OUTCOMES[int(data[0:64], 16)],
            "amount_out": int(data[64:128], 16),
            "fill_tx": outcome["transactionHash"], "fill_block": fill_block, "fill_ts_ms": fill_ts_ms,
            "latency_ms": fill_ts_ms - sample["drop_ts_ms"],
        })

    usdc_in = usdc_in_for_price(pool_reserves(BASE_RPC, POOL_A), start_price)
    if usdc_in:
        restore = send(key, BASE_RPC, POOL_A, "swap(address,uint256,uint256,address)", BASE_USDC, str(usdc_in), "0", trader)
        sample["restore_tx"] = restore["transactionHash"]
    return sample


def prepare(key: str, trader: str) -> None:
    """One-off approvals and test WETH on Unichain."""
    for rpc_url, token, spender in ((BASE_RPC, BASE_WETH, POOL_A), (BASE_RPC, BASE_USDC, POOL_A),
                                    (UNICHAIN_RPC, UNICHAIN_WETH, ORDER_BOOK)):
        if call_uint(rpc_url, token, "allowance(address,address)(uint256)", trader, spender)[0] < MAX_UINT256 // 2:
            send(key, rpc_url, token, "approve(address,uint256)", spender, str(MAX_UINT256))
    if call_uint(UNICHAIN_RPC, UNICHAIN_WETH, "balanceOf(address)(uint256)", trader)[0] < 10 * ORDER_WETH:
        send(key, UNICHAIN_RPC, UNICHAIN_FAUCET, "claim()")


def main() -> None:
    sample_count = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    out_path = sys.argv[2] if len(sys.argv) > 2 else None
    with open(KEY_PATH) as handle:
        entry = json.load(handle)[0]
    key, trader = entry["private_key"], entry["address"]
    topics = {
        "placed": topic("OrderPlaced(uint256,address,address,uint256,uint8,uint256,uint256,uint64)"),
        "outcome": topic("OrderOutcome(uint256,uint8,uint256,uint256,uint256,uint256)"),
        "mirrored": topic("OrderMirrored(uint256,uint8,uint8)"),
        "triggered": topic("OrderTriggered(uint256,uint256,uint256,bool)"),
    }
    prepare(key, trader)
    samples: List[Dict[str, Any]] = []
    for index in range(1, sample_count + 1):
        funds = lasna_funds_wei(ORDER_REACTIVE)
        if funds < MIN_LASNA_FUNDS_WEI:
            print(f"stopping: OrderReactive has {funds / WAD:.3f} lREACT left", flush=True)
            break
        sample = run_sample(key, trader, topics)
        samples.append(sample)
        print(f"sample {index}: order {sample['order_id']} {sample.get('outcome')} "
              f"latency {sample.get('latency_ms')} ms", flush=True)
        if out_path:
            with open(out_path, "w") as handle:
                json.dump({"summary": summarize(samples), "samples": samples}, handle, indent=1)
        time.sleep(PAUSE_BETWEEN_SAMPLES_S)
    print(json.dumps(summarize(samples), indent=1))


if __name__ == "__main__":
    main()
