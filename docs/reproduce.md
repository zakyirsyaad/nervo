# Reproduce the deployment and the measurements

This guide deploys both stacks, runs the demo scenarios, and re-runs the latency benchmark and the filter comparison. Every number in the main [README](../README.md) can be regenerated this way.

## Before you start

- [Foundry](https://book.getfoundry.sh/) and Python 3.9+. The Python tools use only the standard library.
- A Foundry keystore account (`cast wallet import <name> --interactive`). Commands below write it as `<account>`.
- Base Sepolia ETH for gas and for the executor's callback budget, and lREACT on Reactive Lasna for the Reactive contract. To get lREACT, send Sepolia ETH to the Reactive faucet contract on Ethereum Sepolia, `0x9b9BB25f1A81078C544C829c5EB7822d747Cf434` (1 ETH gives 100 lREACT, at most 5 ETH per transaction; see the [Reactive docs](https://dev.reactive.network/reactive-mainnet)).
- `cp .env.example .env`. Forge scripts read addresses from the environment, and the Python tools load `.env` themselves. To make `.env` visible to forge scripts, export it first: `set -a; . ./.env; set +a`.

Scripts that use `msg.sender` as the owner (for example `DeployFaucet`) also need `--sender <your address>`.

## 1. Deploy the main stack

`ArbExecutor` stores the address of `ArbReactive` as an immutable, but `ArbReactive` is deployed afterwards on another chain. The origin deploy therefore predicts that address from your deployer's nonce on Lasna. Set `LASNA_NONCE` to the nonce your deployer will have when `DeployReactive` runs:

```bash
cast nonce <your address> --rpc-url lasna
```

Deploy the test tokens, both pools and the executor on Base Sepolia. `EXECUTOR_FUNDING_WEI` funds the executor's callback budget.

```bash
forge script script/DeployOrigin.s.sol --rpc-url base_sepolia --account <account> --broadcast
```

Copy `POOL_A`, `POOL_B`, `EXECUTOR` and `EXPECTED_REACTIVE` from the output into `.env`, then deploy the Reactive contract on Lasna. `REACTIVE_FUNDING_WEI` funds its `react()` calls.

```bash
forge script script/DeployReactive.s.sol --rpc-url lasna --account <account> --broadcast
```

The script checks that the deployed address equals `EXPECTED_REACTIVE`. If your Lasna nonce moved in between, redeploy the origin side with the new nonce.

Optional parameters and their defaults are listed in [.env.example](../.env.example): input size 1,000 USDC, minimum surplus 2 USDC, cost buffer 0, callback deadline 60 s, callback gas limit 600,000, maximum snapshot age 1 day.

To top up the Reactive contract later:

```bash
cast send 0x8888888888888888888888888888888888888888 "depositTo(address)" $REACTIVE --value 1ether --rpc-url lasna --account <account>
```

Each loop costs about 0.05 lREACT: `react()` runs for the trigger swap and for the executor's two swaps.

## 2. Run the demo scenarios

[script/Scenario.s.sol](../script/Scenario.s.sol) moves Pool B with real swaps and leaves Pool A alone. The caller must own both pools. Run `neutralize()` between scenarios so each starts from equal prices.

| Signature | What it does | Expected result |
|---|---|---|
| `seed()` | Fills both pools with 100 WETH / 300,000 USDC | No callback |
| `persist()` | One swap opens a 2% gap | Lasna requests a callback; the executor trades both legs |
| `vanish()` | One swap opens a 2% gap, a second closes it to 1% | Lasna requests a callback; the executor records `SkippedMarginGone` |
| `reject()` | One swap opens a 1% gap | Lasna records `MarginBelowThreshold`; no callback |
| `neutralize()` | Sets Pool B to Pool A's reserves in one event | No callback |
| `status()` | Prints reserves, prices and quotes | Sends nothing |

```bash
forge script script/Scenario.s.sol --sig "persist()" --rpc-url base_sepolia --account <account> --broadcast
```

`vanish()` relies on both swaps landing before the callback arrives. On testnet they landed in the same block and the callback arrived 1.2 s later.

## 3. Watch a loop live

[tools/observe.py](../tools/observe.py) polls both chains from one machine and prints every pool update, decision and outcome as it appears. Its timings include polling delay; the benchmark below uses block timestamps instead.

```bash
python3 tools/observe.py 120 observer.jsonl
```

## 4. Latency benchmark

The benchmark sends trigger swaps from a throwaway trader so your own wallet is never automated.

Create the trader. The key file is git-ignored; never commit or share it.

```bash
cast wallet new --json > .bench-trader.json
```

Put its address in `.env` as `TRADER`, then fund it with gas and test tokens from the deployer:

```bash
forge script script/FundTrader.s.sol --rpc-url base_sepolia --account <account> --broadcast
```

Send samples. Each one is a swap that opens a 2% gap on Pool B, about 18 seconds apart so the previous arbitrage has settled. The driver stops before the Reactive contract runs out of lREACT. Add `--dry-run` to see the plan without sending.

```bash
python3 tools/bench_trader.py 10
```

Pair every `CallbackRequested` decision with its `ArbOutcome` and compute latency from Base Sepolia block timestamps:

```bash
python3 tools/latency_report.py evidence/latency-new.json
```

## 5. Filter comparison

The comparison stack gets its own pools and executor on the same test tokens, so the two executors never compete for the same gap.

Deploy the origin side (env `WETH`, `USDC`, `LASNA_NONCE`):

```bash
forge script script/DeployBaseline.s.sol --rpc-url base_sepolia --account <account> --broadcast
```

Deploy its Reactive contract with filtering turned off, using the comparison stack's addresses:

```bash
REQUEST_EVERY_CANDIDATE=true POOL_A=$BASELINE_POOL_A POOL_B=$BASELINE_POOL_B EXECUTOR=$BASELINE_EXECUTOR EXPECTED_REACTIVE=$BASELINE_REACTIVE forge script script/DeployReactive.s.sol --rpc-url lasna --account <account> --broadcast
```

Seed the comparison pools and fund both Reactive contracts. The script hard-codes the original deployer address and keystore name; edit them first.

```bash
sh tools/prepare_compare.sh
```

Run 3 rounds. Each round moves Pool B to gaps of 0.5%, 1%, 1.3% and 2% against Pool A, sending each step to both stacks before the next.

```bash
python3 tools/compare_driver.py 3 evidence/compare-run-new.json
```

Compute decisions, outcomes, latency and funds spent per stack from chain data:

```bash
python3 tools/compare_report.py evidence/compare-run-new.json evidence/compare-new.json
```

## 6. Faucet for the web app

The web app hands out test tokens from a pre-funded faucet. The deployer must own both test tokens.

```bash
WETH_ADDRESS=$WETH USDC_ADDRESS=$USDC forge script script/DeployFaucet.s.sol:DeployFaucet --rpc-url base_sepolia --account <account> --sender <your address> --broadcast
```

It funds 500 claims of 5 WETH and 10,000 USDC, one claim per address per day. Put the printed address in `web/.env.local` as `NEXT_PUBLIC_FAUCET_ADDRESS`.

## 7. Protective orders

The order book lives on Unichain Sepolia and is triggered by Pool A of the main stack on Base Sepolia. The Reactive contract on Lasna is deployed second, at an address predicted from the deployer's Lasna nonce, exactly as for the arbitrage stack.

Read the Lasna nonce and the current Base Pool A price (seed the Unichain pool near it):

```bash
cast nonce <your address> --rpc-url lasna
```

```bash
cast call 0x82DEA86F73edF0CC76cd2Ff4Ae8612380e63CE6F "getReserves()(uint256,uint256)" --rpc-url base_sepolia
```

Deploy the test tokens, the execution pool, a faucet and the order book on Unichain Sepolia. `ORDERBOOK_FUNDING_WEI` pays for execution callbacks; every order also adds its 0.0001 ETH fee.

```bash
LASNA_NONCE=<nonce> ORDER_POOL_WETH=100000000000000000000 ORDER_POOL_USDC=332800000000 ORDERBOOK_FUNDING_WEI=20000000000000000 forge script script/DeployOrders.s.sol --rpc-url unichain_sepolia --account <account> --sender <your address> --broadcast
```

Deploy the Reactive contract on Lasna with the printed `ORDER_BOOK` and `EXPECTED_ORDER_REACTIVE`. The script aborts if the address does not match.

```bash
ORDER_BOOK=<address> EXPECTED_ORDER_REACTIVE=<address> REACTIVE_FUNDING_WEI=3000000000000000000 forge script script/DeployOrderReactive.s.sol --rpc-url lasna --account <account> --sender <your address> --broadcast
```

Run one order end to end: place a stop-loss on Unichain, wait for Lasna to mirror it, then sell WETH on Base Pool A so the price falls through the trigger.

```bash
ORDER_BOOK=<address> ORDER_FAUCET=<address> TRIGGER_PRICE=3300000000 MIN_OUT=320000000 forge script script/OrderScenario.s.sol --sig "place()" --rpc-url unichain_sepolia --account <account> --sender <your address> --broadcast
```

```bash
forge script script/OrderScenario.s.sol --sig "drop()" --rpc-url base_sepolia --account <account> --sender <your address> --broadcast
```

To measure latency over many orders, fund the benchmark trader from section 4 with a little Unichain Sepolia ETH (each order needs its 0.0001 ETH fee plus gas), align Pool B with Pool A (`neutralize()` in section 2) so the price moves stay below the arbitrage threshold, and run:

```bash
python3 tools/order_bench.py 10 evidence/order-latency-new.json
```

The driver claims test WETH from the Unichain faucet if needed, approves once, and stops early if the order contract on Lasna drops below 0.2 lREACT.

Unichain Sepolia ETH can be bridged from Ethereum Sepolia by sending ETH to its L1StandardBridge, `0xea58fcA6849d79EAd1f26608855c2D6407d54Ce2`.

## 8. Mainnet replay

See [replay/README.md](../replay/README.md). It needs no keys: it reads public Base mainnet logs.

## 9. Source verification

Publish the source to [Sourcify](https://sourcify.dev), which Blockscout and Reactscan read. No API key is needed. Run it from a clean `forge build` of the commit you deployed: if comments changed since, Sourcify still accepts the contract as a partial match (same bytecode, different metadata hash).

```bash
forge verify-contract --verifier sourcify --chain-id <chain id> <address> <path>:<contract>
```

Chain ids: Base Sepolia `84532`, Unichain Sepolia `1301`, Lasna `5318007`. The address and contract pairs are listed in [tools/verify_deployed.py](../tools/verify_deployed.py); the two Unichain test tokens use `src/fixtures/TestToken.sol:TestToken`.
