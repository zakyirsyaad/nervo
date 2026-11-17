# Evidence

Recorded results behind the numbers in the main [README](../README.md). Each file was written by a tool in [tools/](../tools/) from chain data and is kept exactly as produced. The field names are in Indonesian because the tools wrote them that way; the glossary below translates them.

| File | Written by | What it holds |
|---|---|---|
| [latency-2026-11-16.json](latency-2026-11-16.json) | `tools/latency_report.py` | **The latency result.** 12 callbacks, each with the hashes and blocks of all three stages |
| [compare-run-2026-11-16.json](compare-run-2026-11-16.json) | `tools/compare_driver.py` | Run log of the filter comparison: both stacks' addresses, block range, funds before and after, and every step's transaction |
| [compare-2026-11-16.json](compare-2026-11-16.json) | `tools/compare_report.py` | **The comparison result**, computed from the run log and chain data |
| [order-latency-2026-11-17.json](order-latency-2026-11-17.json) | `tools/order_bench.py` | **The order latency result.** 10 stop-losses, each with the placement, mirror, price drop, trigger, fill and restore transactions, and the trigger-to-fill latency |
| [order-2026-11-17.json](order-2026-11-17.json) | Collected from chain logs | **The first protective order**: every stage on Unichain Sepolia, Lasna and Base Sepolia, with the trigger-to-fill latency |
| [latency-2026-11-15.json](latency-2026-11-15.json) | `tools/latency_report.py` | First, partial run with the 2 demo-scenario callbacks only. Superseded by the 16 November file, which includes them |
| [observer-2026-11-15.jsonl](observer-2026-11-15.jsonl) | `tools/observe.py` | Raw event stream of the first demo scenarios as one machine saw them, one JSON object per line |
| [../replay/data/summary.json](../replay/data/summary.json) | `replay/replay.py` | Base mainnet replay of WETH/USDC |
| [../replay/data/crosschain-summary.json](../replay/data/crosschain-summary.json) | `replay/crosschain.py` | ETH/USDC between Base and Unichain, English field names, with a sensitivity check on Unichain's one-second timestamps |
| [../replay/data/pairs-summary.json](../replay/data/pairs-summary.json) | `replay/replay.py --all` | The same replay for ten pairs, English field names. `single_range_pct` is the share of episodes whose quote stays inside one tick range; `viable_2s_surplus_total` is the surplus still available 2 s after the signal |

## How latency is measured

Latency is `blockTimestampMs` of the Base Sepolia block holding the callback minus `blockTimestampMs` of the Base Sepolia block holding the trigger swap. Both timestamps come from the same chain, so no clock synchronisation is involved. Base Sepolia stamps a block every 200 ms, which is the resolution. Lasna timestamps are not used because they are not on the same clock.

A decision on Lasna and an outcome on Base Sepolia are matched by their opportunity id, `keccak256(abi.encode(chainId, pool, txHash, logIndex))` of the trigger log.

## Glossary

### latency-*.json

| Field | Meaning |
|---|---|
| `ringkasan` | Summary |
| `sumber_waktu` | Time source used |
| `callback_diminta` | Callbacks requested on Lasna |
| `callback_tiba` | Callbacks that arrived on Base Sepolia |
| `timeout` | Requested callbacks that did not arrive within 60 s |
| `menunggu` | Callbacks still pending when the report was written |
| `p50_ms`, `p95_ms`, `min_ms`, `maks_ms` | Latency median, 95th percentile (nearest rank), minimum, maximum |
| `outcome` | Count of each `ArbOutcome` |
| `sampel` | Samples, one per callback |
| `origin_*`, `lasna_*`, `callback_*` | Trigger swap, Lasna decision, and callback transaction and block |
| `quoted_out` | USDC the Lasna contract quoted for the 1,000 USDC round trip, 6 decimals |
| `latency_ms` | Callback block timestamp minus trigger block timestamp |

### compare-*.json

| Field | Meaning |
|---|---|
| `berfilter` | Filtered stack (main stack) |
| `tanpa_filter` | No-filter stack (`requestEveryCandidate`) |
| `rentang_blok.awal`, `rentang_blok.akhir` | First and last block of the run, per chain |
| `selisih_bps` | Gap targets per round, in basis points |
| `langkah` | Steps per stack |
| `log_diproses` | Logs processed by `react()` |
| `keputusan` | Count of each `DecisionRecorded` decision |
| `callback_diminta` | Callbacks requested |
| `callback_terbuang` | Callbacks that ended in a skip (wasted) |
| `terpakai.lreact`, `terpakai.eth_executor` | lREACT spent on Lasna, ETH spent by the executor on callbacks |
| `lreact_per_eksekusi` | lREACT spent per executed trade |
| `latensi` | Callback latency for that stack |

The run log (`compare-run-*.json`) uses English field names apart from the two stack names.

### replay/data/summary.json

| Field | Meaning |
|---|---|
| `titik_evaluasi` | Evaluation points: the state of both pools after every transaction that contains a swap |
| `jam` | Hours covered |
| `harga_awal`, `harga_akhir` | WETH price in USDC at the start and end |
| `ringkasan` | One row per input size and threshold |
| `input_usdc`, `ambang_usdc` | Round-trip input and surplus threshold |
| `titik_kandidat` | Evaluation points above the threshold |
| `episode` | Episodes: a run of consecutive points above the threshold |
| `layak_1s`, `layak_2s`, `layak_5s` (`_pct`) | Episodes still profitable 1, 2 and 5 s after the signal |
| `durasi_p50_ms`, `durasi_p95_ms` | Episode duration median and 95th percentile |
| `surplus_sinyal_p50_usdc`, `total_surplus_sinyal_usdc` | Median and total surplus at the moment of the signal |
| `durasi.<input>@<threshold>` | How long episodes lasted: `blok_sama` same block, `satu_blok_200ms` one block, `sampai_1s` up to 1 s, `sampai_5s` up to 5 s, `lebih_5s` longer |
| `akhir_blok.<input>@<threshold>` | Gaps at the end of each block: `blok_dengan_swap` blocks with a swap, `gap_bps_p50/p99/maks` gap percentiles and maximum, `akhir_blok_layak` blocks that ended above the threshold, `surplus_maks_usdc` largest surplus |
