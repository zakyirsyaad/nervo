"""Fetches Swap events of the Unichain ETH/USDC Uniswap V4 pool for the replay window into a CSV.

The pool is the busiest ETH/USDC pool on Unichain without hooks: native ETH / USDC, 0.05% fee,
tick spacing 10. Uniswap V4 keeps every pool in one PoolManager, so the pool is selected by its id
(topic1 of the Swap event), keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks)).

Unichain produces one block per second, so timestamps have one-second resolution.
Usage: python3 fetch_unichain.py   (writes data/swaps-unichain-ETH-USDC.csv)
"""
import csv
import json
import sys
import time
import urllib.request

RPC_URL = "https://mainnet.unichain.org"
POOL_MANAGER = "0x1F98400000000000000000000000000000000004"
POOL_ID = "0x3258f413c7a88cda2fa8709a589d221a80f6574f63df5a5b6774485d8acc39d9"
SWAP_TOPIC = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f"
START_BLOCK = 63_581_641  # 2026-11-11 00:00:00 WIB (UTC+7), same window as the Base replay
END_BLOCK = 63_840_840    # last block before 2026-11-14 00:00:00 WIB
CHUNK_BLOCKS = 1_000      # the public RPC rejects larger eth_getLogs ranges
MAX_RETRIES = 6
OUT_PATH = "data/swaps-unichain-ETH-USDC.csv"
POOL_NAME = "unichain-v4"
FIELDS = ["block", "log_index", "ts_ms", "pool", "tx_hash",
          "amount0", "amount1", "sqrt_price_x96", "liquidity", "tick", "fee"]


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = urllib.request.Request(
        RPC_URL, data=body,
        headers={"content-type": "application/json", "user-agent": "replay-fetch/0.2"})
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                reply = json.load(response)
            if "error" in reply:
                raise RuntimeError(reply["error"])
            return reply["result"]
        except Exception as error:  # network error or rate limit: retry with backoff
            if attempt == MAX_RETRIES - 1:
                raise
            print(f"  retry {method} ({error})", file=sys.stderr)
            time.sleep(2 ** attempt)


def signed(word_hex, bits=256):
    value = int(word_hex, 16)
    return value - (1 << bits) if value >> (bits - 1) else value


def decode(log):
    """V4 Swap: amount0, amount1 (from the swapper's side, negative = paid in), sqrtPriceX96, liquidity, tick, fee."""
    data = log["data"][2:]
    words = [data[i:i + 64] for i in range(0, 384, 64)]
    return {
        "block": int(log["blockNumber"], 16),
        "log_index": int(log["logIndex"], 16),
        "ts_ms": int(log["blockTimestamp"], 16) * 1000,
        "pool": POOL_NAME,
        "tx_hash": log["transactionHash"],
        "amount0": signed(words[0]),
        "amount1": signed(words[1]),
        "sqrt_price_x96": int(words[2], 16),
        "liquidity": int(words[3], 16),
        "tick": signed(words[4]),
        "fee": int(words[5], 16),
    }


def main():
    total = 0
    with open(OUT_PATH, "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        for start in range(START_BLOCK, END_BLOCK + 1, CHUNK_BLOCKS):
            stop = min(start + CHUNK_BLOCKS - 1, END_BLOCK)
            logs = rpc("eth_getLogs", [{
                "fromBlock": hex(start), "toBlock": hex(stop),
                "address": POOL_MANAGER, "topics": [SWAP_TOPIC, POOL_ID]}])
            rows = sorted((decode(log) for log in logs if not log.get("removed")),
                          key=lambda row: (row["block"], row["log_index"]))
            writer.writerows(rows)
            total += len(rows)
            if (start - START_BLOCK) % 20_000 == 0:
                print(f"{start}-{stop}: total {total}", flush=True)
    print(f"done: {total} swaps -> {OUT_PATH}")


if __name__ == "__main__":
    main()
