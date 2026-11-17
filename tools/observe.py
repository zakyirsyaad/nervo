"""Single observer for the origin -> Lasna -> destination loop.

Polls logs on both networks from one machine and records the local time when each log is first seen.
The reported latency is the difference in observation time, not in block timestamps, so it
carries an error of up to one polling interval plus RPC delay.

Usage: python3 tools/observe.py <seconds> [output_file.jsonl]
Addresses are read from the environment or .env: POOL_A, POOL_B, EXECUTOR, REACTIVE.
"""
import json
import os
import sys
import time
import urllib.request

BASE_RPC = os.environ.get("BASE_SEPOLIA_RPC_URL", "https://base-sepolia-rpc.publicnode.com")
LASNA_RPC = os.environ.get("LASNA_RPC_URL", "https://lasna-rpc.rnk.dev/")
POLL_INTERVAL_S = 0.25
REQUEST_TIMEOUT_S = 10

TOPICS = {
    "0x5ea238b9875a66e8fd913e81373316c8edfcc252407a0dc9e9fc9a68f5eb05ce": "ReserveUpdate",
    "0xcd3829a3813dc3cdd188fd3d01dcf3268c16be2fdd2dd21d0665418816e46062": "Swap",
    "0x2a4669c149e459748526d060f6adaf92fe69f08b8682a3e1e328e8cddc355837": "ArbOutcome",
    "0x63c7fe3aff8526d74db76689a0432840776f1c26e3ccab419b647f14ec64ce16": "DecisionRecorded",
}
DECISIONS = ("CallbackRequested", "UnknownSource", "StaleOrDuplicateLog", "SnapshotIncomplete",
             "SnapshotStale", "ExecutorSwap", "MarginBelowThreshold")
OUTCOMES = ("Executed", "SkippedAlreadyExecuted", "SkippedExpired", "SkippedInvalidRoute",
            "SkippedInputOutOfBounds", "SkippedMarginGone", "SkippedInsufficientInventory", "SwapReverted")


def load_env(path=".env"):
    if not os.path.exists(path):
        return
    with open(path) as handle:
        for line in handle:
            key, sep, value = line.strip().partition("=")
            if sep and not key.startswith("#"):
                os.environ.setdefault(key, value)


def rpc(url, method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = urllib.request.Request(
        url, data=body, headers={"content-type": "application/json", "user-agent": "loop-observer/0.1"})
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_S) as response:
        reply = json.load(response)
    if "error" in reply:
        raise RuntimeError(reply["error"])
    return reply["result"]


def words(data_hex):
    data = data_hex[2:]
    return [int(data[i:i + 64], 16) for i in range(0, len(data), 64)]


def describe(log):
    """Turns a raw log into a short, readable record."""
    name = TOPICS.get(log["topics"][0], "other")
    record = {
        "event": name,
        "address": log["address"].lower(),
        "block": int(log["blockNumber"], 16),
        "tx_hash": log["transactionHash"],
        "log_index": int(log["logIndex"], 16),
    }
    if "blockTimestampMs" in log:
        record["block_ts_ms"] = int(log["blockTimestampMs"], 16)
    elif "blockTimestamp" in log:
        record["block_ts_s"] = int(log["blockTimestamp"], 16)
    values = words(log["data"])
    if name == "ReserveUpdate":
        record.update(initiator="0x" + log["topics"][1][-40:], reserve_weth=values[0],
                      reserve_usdc=values[1], sequence=values[2], source_ts=values[3])
    elif name == "DecisionRecorded":
        record.update(opportunity_id=log["topics"][1], decision=DECISIONS[values[0]],
                      origin_tx_hash=hex(values[1]), origin_log_index=values[2], sequence=values[3],
                      route=values[4], quoted_out=values[5], source_ts=values[6])
    elif name == "ArbOutcome":
        record.update(opportunity_id=log["topics"][1], outcome=OUTCOMES[values[0]], route=values[1],
                      amount_in=values[2], min_surplus=values[3], quoted_out=values[4], actual_out=values[5])
    return record


class Watcher:
    def __init__(self, chain, url, addresses):
        self.chain = chain
        self.url = url
        self.addresses = addresses
        self.next_block = int(rpc(url, "eth_blockNumber", []), 16) + 1

    def poll(self):
        latest = int(rpc(self.url, "eth_blockNumber", []), 16)
        if latest < self.next_block:
            return []
        logs = rpc(self.url, "eth_getLogs", [{
            "fromBlock": hex(self.next_block), "toBlock": hex(latest), "address": self.addresses}])
        self.next_block = latest + 1
        return logs


def main():
    load_env()
    duration_s = float(sys.argv[1]) if len(sys.argv) > 1 else 120
    out_path = sys.argv[2] if len(sys.argv) > 2 else None
    watchers = [
        Watcher("base-sepolia", BASE_RPC,
                [os.environ["POOL_A"], os.environ["POOL_B"], os.environ["EXECUTOR"]]),
        Watcher("lasna", LASNA_RPC, [os.environ["REACTIVE"]]),
    ]
    out = open(out_path, "a") if out_path else None
    started = time.time()
    print(f"observing for {duration_s:.0f} seconds, interval {POLL_INTERVAL_S} s", flush=True)
    while time.time() - started < duration_s:
        tick = time.time()
        for watcher in watchers:
            try:
                logs = watcher.poll()
            except Exception as error:  # public RPCs sometimes refuse; log it and continue
                print(f"[{watcher.chain}] polling error: {error}", file=sys.stderr, flush=True)
                continue
            seen_ms = int(time.time() * 1000)
            for log in logs:
                record = {"chain": watcher.chain, "seen_ms": seen_ms, **describe(log)}
                line = json.dumps(record)
                print(line, flush=True)
                if out:
                    out.write(line + "\n")
                    out.flush()
        time.sleep(max(0.0, POLL_INTERVAL_S - (time.time() - tick)))
    if out:
        out.close()


if __name__ == "__main__":
    main()
