"""Token pairs replayed on Base mainnet, each traded on two concentrated-liquidity pools.

Pools were found through the Uniswap V3 factory (0x33128a8fC17869897dcE68Ed026d694621f6FDfD) and
the Aerodrome Slipstream factory (0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A), and picked so that
both pools of a pair saw regular swaps in the replay window.

Input sizes and thresholds are in the quote token. Pairs quoted in WETH use 0.05, 0.5 and 5 WETH, about
100, 1,000 and 10,000 USD at the window's average price of about 1,970 USDC, and thresholds of about 0.10 and
2.00 USD.
"""
from dataclasses import dataclass
from typing import Optional, Tuple

USDC = 10 ** 6
WETH = 10 ** 18


@dataclass(frozen=True)
class Pool:
    name: str
    address: str
    fee_ppm: Optional[int]  # None: read the fee actually charged from the swaps (dynamic fees)
    tick_spacing: int


@dataclass(frozen=True)
class Pair:
    key: str
    base: str
    quote: str
    decimals0: int
    decimals1: int
    quote_is_token1: bool
    pools: Tuple[Pool, Pool]
    inputs: Tuple[int, ...]
    thresholds: Tuple[int, ...]
    min_fee_amount0: int = 10 ** 7  # smallest swap used to infer a dynamic fee, raw token0 units
    min_fee_amount1: int = 10 ** 7

    @property
    def quote_decimals(self) -> int:
        return self.decimals1 if self.quote_is_token1 else self.decimals0

    @property
    def swaps_path(self) -> str:
        return "data/swaps.csv" if self.key == "WETH-USDC" else f"data/swaps-{self.key}.csv"


def uni(address: str, fee_ppm: int) -> Pool:
    spacing = {100: 1, 500: 10, 3000: 60, 10000: 200}[fee_ppm]
    return Pool(f"uni-{fee_ppm}", address, fee_ppm, spacing)


def aero(address: str, tick_spacing: int) -> Pool:
    return Pool(f"aero-{tick_spacing}", address, None, tick_spacing)


USDC_INPUTS = (100 * USDC, 1_000 * USDC, 10_000 * USDC)
USDC_THRESHOLDS = (USDC // 10, 2 * USDC)
WETH_INPUTS = (WETH // 20, WETH // 2, 5 * WETH)
WETH_THRESHOLDS = (WETH // 20_000, WETH // 1_000)

PAIRS: Tuple[Pair, ...] = (
    # The original replay. Its own settings are kept so data/summary.json stays reproducible.
    Pair("WETH-USDC", "WETH", "USDC", 18, 6, True,
         (Pool("univ3", "0xd0b53d9277642d899df5c87a3966a349a798f224", 500, 10),
          Pool("aero", "0xb2cc224c1c9fee385f8ad6a55b4d94e92359dc59", None, 100)),
         inputs=(1_000 * USDC, 10_000 * USDC), thresholds=(USDC // 100, USDC // 10, USDC // 2, 2 * USDC),
         min_fee_amount0=5 * 10 ** 16, min_fee_amount1=100 * USDC),
    # Token order below is each pool's token0 / token1, read from the pools on chain.
    Pair("cbBTC-USDC", "cbBTC", "USDC", 6, 8, False,  # USDC / cbBTC
         (uni("0xfbb6eed8e7aa03b138556eedaf5d271a5e1e43ef", 500),
          aero("0x4e962bb3889bf030368f56810a9c96b83cb3e778", 100)),
         inputs=USDC_INPUTS, thresholds=USDC_THRESHOLDS),
    Pair("cbBTC-WETH", "cbBTC", "WETH", 18, 8, False,  # WETH / cbBTC
         (uni("0x7aea2e8a3843516afa07293a10ac8e49906dabd1", 500),
          aero("0x22aee3699b6a0fed71490c103bd4e5f3309891d5", 1)),
         inputs=WETH_INPUTS, thresholds=WETH_THRESHOLDS),
    Pair("EURC-USDC", "EURC", "USDC", 6, 6, True,  # EURC / USDC
         (uni("0x7279c08a36333e12c3fc81747963264c100d66fb", 500),
          aero("0xc5e51044eb7318950b1afb044fccfb25782c48c1", 1)),
         inputs=USDC_INPUTS, thresholds=USDC_THRESHOLDS),
    Pair("VIRTUAL-WETH", "VIRTUAL", "WETH", 18, 18, True,  # VIRTUAL / WETH
         (uni("0x9c087eb773291e50cf6c6a90ef0f4500e349b903", 500),
          aero("0x3f0296bf652e19bca772ec3df08b32732f93014a", 100)),
         inputs=WETH_INPUTS, thresholds=WETH_THRESHOLDS),
    Pair("ZORA-USDC", "ZORA", "USDC", 18, 6, True,  # ZORA / USDC
         (uni("0xedc625b74537ee3a10874f53d170e9c17a906b9c", 3000),
          aero("0x3f53f1fd5b7723ddf38d93a584d280b9b94c3111", 100)),
         inputs=USDC_INPUTS, thresholds=USDC_THRESHOLDS),
    Pair("MORPHO-WETH", "MORPHO", "WETH", 18, 18, False,  # WETH / MORPHO
         (uni("0x2f42df4af5312b492e9d7f7b2110d9c7bf2d9e4f", 3000),
          aero("0xb5f0b4ae66c14f7efaa9aa1468e8fc536a3e288c", 200)),
         inputs=WETH_INPUTS, thresholds=WETH_THRESHOLDS),
    Pair("AERO-WETH", "AERO", "WETH", 18, 18, False,  # WETH / AERO
         (uni("0x3d5d143381916280ff91407febeb52f2b60f33cf", 3000),
          aero("0x82321f3beb69f503380d6b233857d5c43562e2d0", 200)),
         inputs=WETH_INPUTS, thresholds=WETH_THRESHOLDS),
    Pair("DEGEN-WETH", "DEGEN", "WETH", 18, 18, False,  # WETH / DEGEN
         (uni("0x0ca6485b7e9cf814a3fd09d81672b07323535b64", 10000),
          aero("0xafb62448929664bfccb0aae22f232520e765ba88", 200)),
         inputs=WETH_INPUTS, thresholds=WETH_THRESHOLDS),
    Pair("BRETT-WETH", "BRETT", "WETH", 18, 18, False,  # WETH / BRETT
         (uni("0xba3f945812a83471d709bce9c3ca699a19fb46f7", 10000),
          aero("0x4e829f8a5213c42535ab84aa40bd4adcce9cba02", 200)),
         inputs=WETH_INPUTS, thresholds=WETH_THRESHOLDS),
)

def by_key(key: str) -> Pair:
    for pair in PAIRS:
        if pair.key == key:
            return pair
    raise KeyError(f"unknown pair {key}; known: {', '.join(p.key for p in PAIRS)}")
