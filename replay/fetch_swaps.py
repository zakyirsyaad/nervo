"""Fetches WETH/USDC Swap events from two Base mainnet pools into a CSV.

Source: public RPC (eth_getLogs). Output: data/swaps.csv, sorted by (block, logIndex).
"""
import csv
import json
import sys
import time
import urllib.request

RPC_URL = "https://base-rpc.publicnode.com"
POOLS = {
    "0xd0b53d9277642d899df5c87a3966a349a798f224": "univ3",
    "0xb2cc224c1c9fee385f8ad6a55b4d94e92359dc59": "aero",
}
SWAP_TOPIC = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67"
START_BLOCK = 55_698_122  # 2026-11-11 00:00:00 WIB (UTC+7)
END_BLOCK = 56_994_121    # last block before 2026-11-14 00:00:00 WIB
CHUNK_BLOCKS = 10_000
MAX_RETRIES = 6
OUT_PATH = "data/swaps.csv"
FIELDS = ["block", "log_index", "ts_ms", "pool", "tx_hash",
          "amount0", "amount1", "sqrt_price_x96", "liquidity", "tick"]


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = urllib.request.Request(
        RPC_URL, data=body,
        headers={"content-type": "application/json", "user-agent": "replay-fetch/0.1"})
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
    data = log["data"][2:]
    words = [data[i:i + 64] for i in range(0, 320, 64)]
    return {
        "block": int(log["blockNumber"], 16),
        "log_index": int(log["logIndex"], 16),
        "ts_ms": int(log["blockTimestampMs"], 16),
        "pool": POOLS[log["address"].lower()],
        "tx_hash": log["transactionHash"],
        "amount0": signed(words[0]),
        "amount1": signed(words[1]),
        "sqrt_price_x96": int(words[2], 16),
        "liquidity": int(words[3], 16),
        "tick": signed(words[4]),
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
                "address": list(POOLS), "topics": [SWAP_TOPIC]}])
            rows = sorted((decode(log) for log in logs if not log.get("removed")),
                          key=lambda row: (row["block"], row["log_index"]))
            writer.writerows(rows)
            total += len(rows)
            print(f"{start}-{stop}: {len(rows)} swaps (total {total})", flush=True)
    print(f"done: {total} swaps -> {OUT_PATH}")


if __name__ == "__main__":
    main()
