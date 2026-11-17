# Arb Loop web app

Three pages that let anyone trigger the loop and check the results without reading Solidity.

| Page | What it does |
|---|---|
| `/` | Explains the loop in plain language, with a real measured example and the deployed contracts |
| `/trade` | Live prices of both pools, a swap form, a test-token faucet, and a tracker that follows your swap to the Lasna decision and back to the trade on Base Sepolia |
| `/evidence` | The latency benchmark, the filter comparison, three example loops and the mainnet replay |

Built with Next.js, wagmi, viem and RainbowKit. The visitor's wallet only ever talks to Base Sepolia; Lasna is read through its public RPC, so visitors never add a second network or hold lREACT.

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
| `pnpm test` | Unit tests: AMM math, formatting, latency statistics, opportunity id, loop status |
| `LIVE=1 pnpm test` | Also replays benchmark sample 1 against the public testnet RPCs and checks the decision, quote, outcome and 1,800 ms latency |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm build` | Production build. All three pages are prerendered |

## How the tracker follows a swap

1. After your swap confirms, the tracker reads its receipt and finds the pool's `ReserveUpdate` log.
2. It computes the opportunity id the Reactive contract will use, `keccak256(abi.encode(chainId, pool, txHash, logIndex))`, and polls Lasna for the `DecisionRecorded` event with that id.
3. If the decision is `CallbackRequested`, it polls Base Sepolia for the executor's `ArbOutcome` with the same id, and reports latency as the difference between the two Base Sepolia block timestamps.
4. Each wait gives up after 60 seconds and offers to keep waiting.

The swap preview uses the same constant-product formula as the contracts ([src/lib/amm.ts](src/lib/amm.ts) mirrors [ArbMath.sol](../src/libraries/ArbMath.sol)), so it predicts what the Reactive contract will decide from the current reserves.

## Layout

```
src/app/              Pages and global styles
src/components/       Header, footer, wallet button, tables shared by pages
src/config/           Chains, contract addresses, ABIs
src/data/             Figures copied from ../evidence/*.json
src/lib/              Pure logic: AMM math, formatting, latency statistics, opportunity id
src/features/trade/   Swap form, faucet, market panel, and the cross-chain loop tracker
```

## Deploy

On Vercel, import the repository with **Root Directory** set to `web` and add the three variables above.
