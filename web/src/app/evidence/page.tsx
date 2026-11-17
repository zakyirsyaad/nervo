import type { Metadata } from "next";
import { ChainMark } from "@/components/ChainMark";
import { CompareTable } from "@/components/CompareTable";
import { ContractTable } from "@/components/ContractTable";
import { HashLink } from "@/components/HashLink";
import { COMPARISON_STACK, GITHUB_URL } from "@/config/contracts";
import {
  BLOCK_INTERVAL_MS,
  CALLBACK_TIMEOUTS,
  CALLBACKS_ARRIVED,
  CALLBACKS_REQUESTED,
  ETH_SAVED_PERCENT,
  FILTERED,
  LATENCIES_MS,
  LATENCY_SAMPLES,
  REPLAY,
  SCENARIOS,
  UNFILTERED,
} from "@/data/evidence";
import { formatSeconds } from "@/lib/format";
import { histogram, percentile } from "@/lib/latency";
import styles from "./evidence.module.css";

export const metadata: Metadata = { title: "Evidence" };

const P50_MS = percentile(LATENCIES_MS, 50) ?? 0;
const BUCKETS = histogram(LATENCIES_MS, BLOCK_INTERVAL_MS);
// Beyond this many duration labels the axis text runs together, so only every n-th bucket is labelled,
// counted back from the slowest bucket so the tail always has a label.
const MAX_AXIS_LABELS = 8;
const AXIS_LABEL_STEP = Math.max(1, Math.ceil(BUCKETS.length / MAX_AXIS_LABELS));
const MAX_COUNT = Math.max(...BUCKETS.map((bucket) => bucket.count), 1);
const EXECUTED_COUNT = LATENCY_SAMPLES.filter((sample) => sample.outcome === "Executed").length;
const MARGIN_GONE_COUNT = LATENCY_SAMPLES.filter((sample) => sample.outcome === "SkippedMarginGone").length;
const OTHER_OUTCOME_COUNT = LATENCY_SAMPLES.length - EXECUTED_COUNT - MARGIN_GONE_COUNT;
const LREACT_DIFF_PERCENT = Math.round((UNFILTERED.lreactSpent / FILTERED.lreactSpent - 1) * 100);

const LATENCY_STATS = [
  { label: "Typical", value: P50_MS },
  { label: "Slow end", value: percentile(LATENCIES_MS, 95) ?? 0 },
  { label: "Fastest", value: Math.min(...LATENCIES_MS) },
  { label: "Slowest", value: Math.max(...LATENCIES_MS) },
];

const REPLAY_CELLS = [
  { label: "Token pairs replayed", value: REPLAY.pairs },
  { label: "Price gaps worth trading", value: REPLAY.episodes },
  { label: "Closed in the same block", value: REPLAY.closedSameBlock },
  { label: "Still open 2 s later", value: REPLAY.viableAfter2s },
];

export default function EvidencePage() {
  const histogramSummary = BUCKETS.map((bucket) => `${formatSeconds(bucket.value)}: ${bucket.count}`).join(", ");

  return (
    <>
      <section className="section">
        <div className="container tight stack">
          <h1 className="h1">The proof behind the numbers.</h1>
          <p className="body-lg">
            Nothing here is an estimate. Every number comes from records on the public test networks, and you can open
            each one yourself. Where a result has a weak spot, we say so.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container stack loose">
          <div className="stack">
            <div className="label">1 · Speed</div>
            <h2 className="h2">How long from a swap to the trade that answers it?</h2>
            <p className="body-lg">
              We ran it {CALLBACKS_REQUESTED} times. {CALLBACK_TIMEOUTS === 0 ? "All " : ""}
              {CALLBACKS_ARRIVED} trades arrived and {CALLBACK_TIMEOUTS} went missing. {EXECUTED_COUNT} were completed,
              and {MARGIN_GONE_COUNT} {MARGIN_GONE_COUNT === 1 ? "was" : "were"} cancelled on arrival because the
              prices had already moved back.
              {OTHER_OUTCOME_COUNT > 0 ? ` ${OTHER_OUTCOME_COUNT} did not trade for another reason.` : ""}
            </p>
          </div>

          <div className={styles.latency}>
            <div className={`cells quad ${styles.stats}`}>
              {LATENCY_STATS.map((stat) => (
                <div key={stat.label} className="cell">
                  <div className="label">{stat.label}</div>
                  <div className="metric">
                    {(stat.value / 1000).toFixed(1)} <span className="unit">seconds</span>
                  </div>
                </div>
              ))}
            </div>

            <div className={`panel ${styles.chartPanel}`}>
              <div className="panel-head label">
                <span>How many runs took how long</span>
                <span>{LATENCIES_MS.length} runs</span>
              </div>
              <div className={styles.chart} role="img" aria-label={`Number of runs per duration: ${histogramSummary}`}>
                {BUCKETS.map((bucket, index) => (
                  <div key={bucket.value} className={styles.barColumn}>
                    <span className="mono num">{bucket.count}</span>
                    <div
                      className={`${styles.bar} ${bucket.value === P50_MS ? styles.median : ""}`}
                      style={{ height: `${(bucket.count / MAX_COUNT) * 100}%` }}
                    />
                    <span className={`mono num faint ${(BUCKETS.length - 1 - index) % AXIS_LABEL_STEP === 0 ? "" : styles.axisHidden}`}>
                      {(bucket.value / 1000).toFixed(1)}s
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="notes">
            <Note title="How we timed it">
              Every block on Base Sepolia carries a timestamp. We subtract the timestamp of the block with the swap
              from the timestamp of the block with the trade.
            </Note>
            <Note title="How precise">
              Those timestamps move in steps of {BLOCK_INTERVAL_MS / 1000} seconds, so every result is a multiple of
              that.
            </Note>
            <Note title="Weak spot">
              Most runs come from one test script that opens the same price gap again and again on a quiet test
              network, so they show one kind of workload. The blue bar is the typical time.
            </Note>
          </div>
        </div>
      </section>

      <section className="section" id="comparison">
        <div className="container stack loose">
          <div className="stack">
            <div className="label">2 · Does checking first help?</div>
            <h2 className="h2">Same trades, far fewer wasted ones.</h2>
            <p className="body-lg">
              Our contract checks whether a trade is worth it before sending it. To see what that check is worth, we
              built a second copy without it, which sends every possible trade, and put both through the same 12 price
              changes.
            </p>
          </div>
          <CompareTable />
          <div className="notes">
            <Note title="What we found">
              Both copies made the same {FILTERED.executed} trades. The copy without the check sent{" "}
              {UNFILTERED.wasted} more that were cancelled on arrival, so checking first cut the fees paid on Base
              Sepolia by {ETH_SAVED_PERCENT}%.
            </Note>
            <Note title="What it does not save">
              The Reactive network charges for every price change it looks at, traded or not. That cost was nearly
              the same for both copies, only {LREACT_DIFF_PERCENT}% apart.
            </Note>
            <Note title="Weak spot">
              This is one run of 12 steps, and the two copies did not start from exactly the same pool sizes.
            </Note>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container stack loose">
          <div className="stack">
            <div className="label">3 · Three real examples</div>
            <h2 className="h2">One example of each way it can end.</h2>
            <p className="body-lg">
              Each row is something that really happened. Click any link to see the record on the public blockchain
              explorer.
            </p>
          </div>
          <div className="panel table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">What happened</th>
                  <th scope="col">
                    <span className="chain-tag">
                      <ChainMark chain="base" />
                      1. The swap
                    </span>
                  </th>
                  <th scope="col">
                    <span className="chain-tag">
                      <ChainMark chain="lasna" />
                      2. The check
                    </span>
                  </th>
                  <th scope="col">
                    <span className="chain-tag">
                      <ChainMark chain="base" />
                      3. The trade
                    </span>
                  </th>
                  <th scope="col" className="numeric">
                    Time taken
                  </th>
                </tr>
              </thead>
              <tbody>
                {SCENARIOS.map((scenario) => (
                  <tr key={scenario.name}>
                    <td>{scenario.name}</td>
                    <td>
                      <HashLink chain="base" hash={scenario.triggerTx} />
                    </td>
                    <td>
                      <div className="mono">{scenario.decision}</div>
                      <HashLink chain="lasna" hash={scenario.decisionTx} />
                    </td>
                    <td>
                      {scenario.callbackTx ? (
                        <>
                          <div className={`mono ${scenario.outcome === "Executed" ? "ok" : "warn"}`}>
                            {scenario.outcome}
                          </div>
                          <HashLink chain="base" hash={scenario.callbackTx} />
                        </>
                      ) : (
                        <span className="muted">Nothing was sent</span>
                      )}
                    </td>
                    <td className="numeric">
                      {scenario.latencyMs ? formatSeconds(scenario.latencyMs) : <span className="muted">No trade</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container split">
          <div className="lead stack">
            <div className="label">4 · Would it make money for real?</div>
            <h2 className="h2">Not on the markets we tested. Here is why.</h2>
            <p className="muted">
              We took three days of real trading (11–13 November 2026) and, for {REPLAY.pairs} token pairs on Base
              from WETH/USDC to small meme coins, compared the two busiest pools on Uniswap and Aerodrome: how often
              did their prices drift far enough apart to be worth trading, and for how long?
            </p>
            <p className="muted">
              Other traders closed almost every gap inside the same block, and none was still open two seconds later.
              On small coins the prices drift further apart, but never by more than the pools&apos; own fees (up to{" "}
              {(REPLAY.widestFeeBandBps / 100).toFixed(2)}%), so there was nothing to gain.
            </p>
            <p className="muted">
              Then we compared the price of ETH on Base and on Unichain, where no one can trade both sides in one
              block. The two chains stayed {REPLAY.crossChainMedianGapBps} basis points apart at the median, and of{" "}
              {REPLAY.crossChainEpisodes} gaps worth trading, only {REPLAY.crossChainViableAfter2s} was still open two
              seconds later. This project proves the method and its speed. It does not beat the competition on these
              markets.
            </p>
            {GITHUB_URL ? (
              <a href={`${GITHUB_URL}/tree/main/replay`} target="_blank" rel="noreferrer" className="link-row">
                How we did the replay ↗
              </a>
            ) : null}
          </div>
          <div className="body cells quad">
            {REPLAY_CELLS.map((cell) => (
              <div key={cell.label} className="cell">
                <div className="label">{cell.label}</div>
                <div className="metric">{cell.value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container stack loose">
          <div className="stack">
            <div className="label">5 · The second copy</div>
            <h2 className="h2">The contracts used for the comparison.</h2>
            <p className="body-lg">
              These belong to the copy without the first check, from section 2. The main contracts are listed on the
              home page.
            </p>
          </div>
          <ContractTable rows={COMPARISON_STACK} />
        </div>
      </section>
    </>
  );
}

interface NoteProps {
  title: string;
  children: React.ReactNode;
}

function Note({ title, children }: NoteProps) {
  return (
    <p className="note">
      <span className="note-title">{title}</span>
      <span>{children}</span>
    </p>
  );
}
