"""Single-tick quote math for concentrated liquidity pools (Uniswap V3 / Slipstream).

token0 = WETH (18 decimals), token1 = USDC (6 decimals). sqrt_price is in Q64.96.
Assumption: a swap does not cross a tick boundary, so the active liquidity is constant.
All functions are pure and use integers; outputs are rounded down.
"""
Q96 = 1 << 96
FEE_DENOMINATOR = 1_000_000  # fee in parts per million (500 = 0.05%)


def after_fee(amount_in, fee_ppm):
    return amount_in * (FEE_DENOMINATOR - fee_ppm) // FEE_DENOMINATOR


def usdc_to_weth(sqrt_price, liquidity, usdc_in, fee_ppm):
    """token1 in, token0 out. Returns (weth_out, new_sqrt_price)."""
    effective_in = after_fee(usdc_in, fee_ppm)
    new_sqrt_price = sqrt_price + effective_in * Q96 // liquidity
    weth_out = liquidity * Q96 * (new_sqrt_price - sqrt_price) // (new_sqrt_price * sqrt_price)
    return weth_out, new_sqrt_price


def weth_to_usdc(sqrt_price, liquidity, weth_in, fee_ppm):
    """token0 in, token1 out. Returns (usdc_out, new_sqrt_price)."""
    effective_in = after_fee(weth_in, fee_ppm)
    numerator = liquidity * Q96
    new_sqrt_price = numerator * sqrt_price // (numerator + effective_in * sqrt_price)
    usdc_out = liquidity * (sqrt_price - new_sqrt_price) // Q96
    return usdc_out, new_sqrt_price


def round_trip_usdc(buy_pool, sell_pool, usdc_in):
    """USDC -> WETH on buy_pool, then WETH -> USDC on sell_pool.

    Each pool is a tuple (sqrt_price, liquidity, fee_ppm). Returns the final USDC.
    """
    weth_out, _ = usdc_to_weth(buy_pool[0], buy_pool[1], usdc_in, buy_pool[2])
    usdc_out, _ = weth_to_usdc(sell_pool[0], sell_pool[1], weth_out, sell_pool[2])
    return usdc_out


def spot_price_usdc_per_weth(sqrt_price):
    return (sqrt_price / Q96) ** 2 * 1e12
