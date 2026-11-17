# Arb Loop web app

Four pages that let anyone trigger the loop, use it, and check the results without reading Solidity.

| Page | What it does |
|---|---|
| `/` | Explains the loop in plain language, with a real measured example and the deployed contracts |
| `/trade` | Live prices of both pools, a swap form, a test-token faucet, and a tracker that follows your swap to the Lasna decision and back to the trade on Base Sepolia |
| `/orders` | Protect: stop-loss, take-profit and limit-buy orders on Unichain Sepolia, triggered by the Base Sepolia Pool A price through Lasna, with a list of your orders and a tracker for each one |
| `/evidence` | The latency benchmark, the filter comparison, three example loops and the mainnet replay |

Built with Next.js, wagmi, viem and RainbowKit. The visitor's wallet talks to Base Sepolia on `/trade` and to Unichain Sepolia on `/orders` (the page asks the wallet to switch); Lasna is only read through its public RPC, so visitors never add it or hold lREACT.

## Run locally

Requires Node 20.9+ and pnpm.

```bash
pnpm install
```

```bash
cp .env.example .env.local
```

```bash
pnpm dev
```

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_FAUCET_ADDRESS` | Test-token faucet on Base Sepolia. The deployed one is `0xBba41830AfEbaDD7298BFC4B0E138c6c90c6D194`. The faucet button stays disabled when unset |
| `NEXT_PUBLIC_WC_PROJECT_ID` | WalletConnect project id from [cloud.reown.com](https://cloud.reown.com). Without it only browser-extension wallets connect |
| `NEXT_PUBLIC_GITHUB_URL` | Repository link shown in the header and footer. Hidden when unset |

All three are public: they are compiled into the browser bundle.

## Commands

| Command | What it does |
|---|---|
| `pnpm test` | Unit tests: AMM math, formatting, latency statistics, opportunity id, loop status, block ranges, order kinds, form checks, order list and cache, order tracker status and texts, error messages |
| `LIVE=1 pnpm test` | Also replays benchmark sample 1 against the public testnet RPCs and checks the decision, quote, outcome and 1,800 ms latency |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm build` | Production build. All three pages are prerendered |

## How the tracker follows a swap

1. After your swap confirms, the tracker reads its receipt and finds the pool's `ReserveUpdate` log.
2. It computes the opportunity id the Reactive contract will use, `keccak256(abi.encode(chainId, pool, txHash, logIndex))`, and polls Lasna for the `DecisionRecorded` event with that id.
3. If the decision is `CallbackRequested`, it polls Base Sepolia for the executor's `ArbOutcome` with the same id, and reports latency as the difference between the two Base Sepolia block timestamps.
4. Each wait gives up after 60 seconds and offers to keep waiting.

## How the order page reads the chains

Addresses of the order stack live in one object, `ORDER_STACK` in [src/config/orders.ts](src/config/orders.ts). Set `orderBookDeployBlock` there after the deploy so scans never read before it. Until the OrderBook has code on Unichain Sepolia, the page says the contracts are not deployed yet and keeps the form disabled.

- **Your orders**: `OrderPlaced` logs filtered by owner over the last 50,000 Unichain blocks (about 14 hours), 1,000 blocks per request because the public RPC rejects larger ranges, 8 requests at a time. The order ids and the last scanned block are cached in `localStorage`, so later scans only read new blocks and orders placed from this browser stay listed. Status comes from `getOrder` in one multicall.
- **Tracker**: for the selected order, Lasna is read from the order's placement time (at most about 7 days back, 30,000 blocks per request) for `OrderMirrored` and `OrderTriggered`, and Unichain from the placement block (at most 50,000 blocks back) for `OrderOutcome` and `OrderCancelled`. Each poll then reads only new blocks, every 2 seconds, until nothing more can happen without the visitor. If Reactive has not mirrored the order after 60 seconds the tracker stops and offers to keep waiting.
- **Latency**: from the Base Sepolia block whose price triggered the order (`sourceTimestamp`) to the Unichain Sepolia block of the outcome (`timestamp`), both in whole seconds.

The swap preview uses the same constant-product formula as the contracts ([src/lib/amm.ts](src/lib/amm.ts) mirrors [ArbMath.sol](../src/libraries/ArbMath.sol)), so it predicts what the Reactive contract will decide from the current reserves.

## Layout

```
src/app/              Pages and global styles
src/components/       Header, footer, wallet button, tables shared by pages
src/config/           Chains, contract addresses, ABIs
src/data/             Figures copied from ../evidence/*.json
src/lib/              Pure logic: AMM math, formatting, latency statistics, opportunity id
src/features/trade/   Swap form, faucet, market panel, and the cross-chain loop tracker
src/features/orders/  Protective-order form, Unichain faucet, prices, order list and the order tracker
```

## Deploy

On Vercel, import the repository with **Root Directory** set to `web` and add the three variables above.
