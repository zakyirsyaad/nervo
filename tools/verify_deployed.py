"""Check that the deployed contracts run exactly the code in this repository.

Compiles nothing itself: run `forge build` first. For each deployed contract it compares the
runtime bytecode on chain with the compiled artifact in out/, after two adjustments that do not
affect behaviour:
- immutable values are written at deploy time, so their slots are zeroed on both sides;
- the trailing CBOR metadata hashes the source text, comments included, so it is removed.

Usage: python3 tools/verify_deployed.py
Needs `cast` (Foundry) on PATH and the RPC aliases from foundry.toml.
"""
from __future__ import annotations

import json
import subprocess
import sys
from typing import List, Tuple

# (artifact file, contract name, address, RPC alias in foundry.toml)
DEPLOYED: List[Tuple[str, str, str, str]] = [
    ("ArbExecutor.sol", "ArbExecutor", "0xb568530a915a7Ae01FBE5917E1B21d666b24DFE4", "base_sepolia"),
    ("ConstantProductPool.sol", "ConstantProductPool", "0x82DEA86F73edF0CC76cd2Ff4Ae8612380e63CE6F", "base_sepolia"),
    ("ConstantProductPool.sol", "ConstantProductPool", "0xf68dE754214b013c206AFD5753b9f26428C29228", "base_sepolia"),
    ("TestToken.sol", "TestToken", "0x29583A3d63FD02f1bE462d4b6A1B1BeCeFcaFB87", "base_sepolia"),  # gitleaks:allow (public token address)
    ("TestToken.sol", "TestToken", "0xb790467931Ad6694747bB90c96ac9b07c0c4DE01", "base_sepolia"),  # gitleaks:allow (public token address)
    ("TestFaucet.sol", "TestFaucet", "0xBba41830AfEbaDD7298BFC4B0E138c6c90c6D194", "base_sepolia"),
    ("ArbReactive.sol", "ArbReactive", "0x0f70a79D1a0DFCB61005AF03084d3bED0e71E932", "lasna"),
    # No-filter comparison stack
    ("ArbExecutor.sol", "ArbExecutor", "0x9429334cBda1E85Cd99691aE4f0BBca2786d597C", "base_sepolia"),
    ("ConstantProductPool.sol", "ConstantProductPool", "0x97898610adD7F402C9D6612e5cF69e395eba7AC0", "base_sepolia"),
    ("ConstantProductPool.sol", "ConstantProductPool", "0xE4140Ea6a6152F6F0cf02D13a56B7A7F60781105", "base_sepolia"),
    ("ArbReactive.sol", "ArbReactive", "0x82DEA86F73edF0CC76cd2Ff4Ae8612380e63CE6F", "lasna"),
]


def strip_metadata(code: bytes) -> bytes:
    """Drop the CBOR metadata; its length is stored in the last two bytes."""
    length = int.from_bytes(code[-2:], "big")
    return code[: -(length + 2)]


def onchain_code(address: str, rpc: str) -> bytes:
    output = subprocess.check_output(["cast", "code", address, "--rpc-url", rpc], text=True).strip()
    return bytes.fromhex(output[2:])


def compare(artifact_file: str, name: str, address: str, rpc: str) -> bool:
    with open(f"out/{artifact_file}/{name}.json") as handle:
        deployed = json.load(handle)["deployedBytecode"]
    local = bytearray(bytes.fromhex(deployed["object"][2:]))
    chain = bytearray(onchain_code(address, rpc))
    for references in deployed.get("immutableReferences", {}).values():
        for reference in references:
            start, length = reference["start"], reference["length"]
            local[start:start + length] = bytes(length)
            chain[start:start + length] = bytes(length)
    return strip_metadata(bytes(local)) == strip_metadata(bytes(chain))


def main() -> int:
    all_match = True
    for artifact_file, name, address, rpc in DEPLOYED:
        matches = compare(artifact_file, name, address, rpc)
        all_match = all_match and matches
        print(f"{'MATCH    ' if matches else 'DIFFERENT'} {name:20} {address} ({rpc})")
    return 0 if all_match else 1


if __name__ == "__main__":
    sys.exit(main())
