"""Fetches Swap events of the replay pools on Base mainnet into one CSV per pair.

Source: public RPC (eth_getLogs). Each CSV is sorted by (block, logIndex).

Usage:
  python3 fetch_swaps.py                   WETH/USDC only, into data/swaps.csv
  python3 fetch_swaps.py DEGEN-WETH ...    the named pairs from pairs.py
  python3 fetch_swaps.py --all             every pair except WETH/USDC
"""
import csv
import json
import sys
import time
import urllib.request

import pairs

RPC_URL = "https://base-rpc.publicnode.com"
SWAP_TOPIC = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67"
START_BLOCK = 55_698_122  # 2026-11-11 00:00:00 WIB (UTC+7)
END_BLOCK = 56_994_121    # last block before 2026-11-14 00:00:00 WIB
CHUNK_BLOCKS = 10_000
MAX_RETRIES = 6
FIELDS = ["block", "log_index", "ts_ms", "pool", "tx_hash",
          "amount0", "amount1", "sqrt_price_x96", "liquidity", "tick"]


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


def decode(log, pool_name):
    data = log["data"][2:]
    words = [data[i:i + 64] for i in range(0, 320, 64)]
    return {
        "block": int(log["blockNumber"], 16),
        "log_index": int(log["logIndex"], 16),
        "ts_ms": int(log["blockTimestampMs"], 16),
        "pool": pool_name,
        "tx_hash": log["transactionHash"],
        "amount0": signed(words[0]),
        "amount1": signed(words[1]),
        "sqrt_price_x96": int(words[2], 16),
        "liquidity": int(words[3], 16),
        "tick": signed(words[4]),
    }


def select_pairs(argv):
    if not argv:
        return [pairs.by_key("WETH-USDC")]
    if argv == ["--all"]:
        return [p for p in pairs.PAIRS if p.key != "WETH-USDC"]
    return [pairs.by_key(key) for key in argv]


def fetch_pair(pair):
    """Writes every Swap of the pair's two pools in the window to pair.swaps_path."""
    names = {pool.address.lower(): pool.name for pool in pair.pools}
    total = 0
    with open(pair.swaps_path, "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        for start in range(START_BLOCK, END_BLOCK + 1, CHUNK_BLOCKS):
            stop = min(start + CHUNK_BLOCKS - 1, END_BLOCK)
            # The public RPC refuses eth_getLogs with many addresses, so each pair is fetched on its own.
            logs = rpc("eth_getLogs", [{
                "fromBlock": hex(start), "toBlock": hex(stop),
                "address": list(names), "topics": [SWAP_TOPIC]}])
            rows = sorted((decode(log, names[log["address"].lower()]) for log in logs if not log.get("removed")),
                          key=lambda row: (row["block"], row["log_index"]))
            writer.writerows(rows)
            total += len(rows)
            print(f"{pair.key} {start}-{stop}: {len(rows)} swaps (total {total})", flush=True)
    print(f"done: {total} swaps -> {pair.swaps_path}", flush=True)


def main(argv):
    for pair in select_pairs(argv):
        fetch_pair(pair)

if __name__ == "__main__":
    main(sys.argv[1:])
