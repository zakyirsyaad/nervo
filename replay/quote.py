"""Single-tick quote math for concentrated liquidity pools (Uniswap V3 / Slipstream).

sqrt_price is sqrt(token1 / token0) in Q64.96, as reported by the pool's Swap event.
Assumption: a swap does not cross a tick boundary, so the active liquidity is constant.
stays_in_tick_range() tells whether that assumption holds for a given swap.
All swap functions are pure and use integers; outputs are rounded down.
"""
import math

Q96 = 1 << 96
FEE_DENOMINATOR = 1_000_000  # fee in parts per million (500 = 0.05%)
TICK_BASE = 1.0001


def after_fee(amount_in, fee_ppm):
    return amount_in * (FEE_DENOMINATOR - fee_ppm) // FEE_DENOMINATOR


def token1_to_token0(sqrt_price, liquidity, amount_in, fee_ppm):
    """token1 in, token0 out. Returns (token0_out, new_sqrt_price)."""
    effective_in = after_fee(amount_in, fee_ppm)
    new_sqrt_price = sqrt_price + effective_in * Q96 // liquidity
    amount_out = liquidity * Q96 * (new_sqrt_price - sqrt_price) // (new_sqrt_price * sqrt_price)
    return amount_out, new_sqrt_price


def token0_to_token1(sqrt_price, liquidity, amount_in, fee_ppm):
    """token0 in, token1 out. Returns (token1_out, new_sqrt_price)."""
    effective_in = after_fee(amount_in, fee_ppm)
    numerator = liquidity * Q96
    new_sqrt_price = numerator * sqrt_price // (numerator + effective_in * sqrt_price)
    amount_out = liquidity * (sqrt_price - new_sqrt_price) // Q96
    return amount_out, new_sqrt_price


# WETH/USDC names: token0 = WETH (18 decimals), token1 = USDC (6 decimals).
usdc_to_weth = token1_to_token0
weth_to_usdc = token0_to_token1


def round_trip(first_pool, second_pool, amount_in, quote_is_token1=True):
    """Quote token -> base token on first_pool, then back to the quote token on second_pool.

    Each pool is a tuple (sqrt_price, liquidity, fee_ppm). Returns the final quote amount.
    """
    if quote_is_token1:
        middle, _ = token1_to_token0(first_pool[0], first_pool[1], amount_in, first_pool[2])
        out, _ = token0_to_token1(second_pool[0], second_pool[1], middle, second_pool[2])
    else:
        middle, _ = token0_to_token1(first_pool[0], first_pool[1], amount_in, first_pool[2])
        out, _ = token1_to_token0(second_pool[0], second_pool[1], middle, second_pool[2])
    return out


def round_trip_usdc(buy_pool, sell_pool, usdc_in):
    """USDC -> WETH on buy_pool, then WETH -> USDC on sell_pool. Returns the final USDC."""
    return round_trip(buy_pool, sell_pool, usdc_in, quote_is_token1=True)


def spot_price(sqrt_price, decimals0, decimals1):
    """Price of one whole token0 in whole token1."""
    return (sqrt_price / Q96) ** 2 * 10 ** (decimals0 - decimals1)


def spot_price_usdc_per_weth(sqrt_price):
    return spot_price(sqrt_price, 18, 6)


def tick_at(sqrt_price):
    """The tick whose price range contains sqrt_price."""
    return math.floor(math.log((sqrt_price / Q96) ** 2) / math.log(TICK_BASE))


def stays_in_tick_range(current_tick, new_sqrt_price, tick_spacing):
    """True if the new price is still inside the current tick-spacing range.

    Liquidity can only change at initialised ticks, which are multiples of tick_spacing, so a
    swap that stays inside the range is quoted exactly by the single-tick math above.
    """
    lower = current_tick // tick_spacing * tick_spacing
    return lower <= tick_at(new_sqrt_price) < lower + tick_spacing
