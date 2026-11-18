import Link from "next/link";
import { ChainMark } from "@/components/ChainMark";
import { CompareBars } from "@/components/CompareBars";
import { ContractTable } from "@/components/ContractTable";
import { HashLink } from "@/components/HashLink";
import { CHAIN_NAME, type ChainKey } from "@/config/chains";
import { MAIN_STACK } from "@/config/contracts";
import {
  CALLBACK_TIMEOUTS,
  CALLBACKS_REQUESTED,
  COMPARE_STEPS,
  ETH_SAVED_PERCENT,
  FILTERED,
  LATENCIES_MS,
  LATENCY_SAMPLES,
  ORDER_LATENCY,
  UNFILTERED,
} from "@/data/evidence";
import { percentile } from "@/lib/latency";
import styles from "./home.module.css";

const P50_MS = percentile(LATENCIES_MS, 50) ?? 0;
const P95_MS = percentile(LATENCIES_MS, 95) ?? 0;
const WITHIN_P95_COUNT = LATENCIES_MS.filter((latency) => latency <= P95_MS).length;
const SAMPLE = LATENCY_SAMPLES[0];
const BASE_BLOCKS_LATER = SAMPLE.callbackBlock - SAMPLE.originBlock;

interface Decision {
  readonly chain: ChainKey;
  readonly label: string;
  readonly title: string;
  readonly body: string;
  readonly events: readonly { readonly name: string; readonly meaning: string }[];
}

const DECISIONS: readonly Decision[] = [
  {
    chain: "lasna",
    label: "First check",
    title: "Is it worth trading?",
    body: "If the gap is too small to cover the fees, it stops here and nothing is sent. That keeps costs down.",
    events: [
      { name: "CallbackRequested", meaning: "Yes, send the trade" },
      { name: "MarginBelowThreshold", meaning: "No, the gap is too small" },
      { name: "ExecutorSwap", meaning: "That was our own trade, ignore it" },
    ],
  },
  {
    chain: "base",
    label: "Second check",
    title: "Is it still worth it now?",
    body: "Prices can move in the second or two the trade takes to arrive, so it is checked again against the latest prices before any money moves.",
    events: [
      { name: "Executed", meaning: "Traded, profit kept" },
      { name: "SkippedMarginGone", meaning: "Too late, safely cancelled" },
    ],
  },
];

const ARB_STEPS = ["Mint test tokens", "Swap on Pool A or Pool B", "Watch the trade arrive"] as const;

function seconds(ms: number): string {
  return (ms / 1000).toFixed(1);
}

export default function HomePage() {
  const metrics = [
    { label: "Typical time, swap to trade", value: seconds(P50_MS), unit: "seconds", note: `Median of ${LATENCIES_MS.length} measured runs.` },
    { label: "Slow end", value: seconds(P95_MS), unit: "seconds", note: `p95: ${WITHIN_P95_COUNT} of ${LATENCIES_MS.length} runs finished within it.` },
    {
      label: "Trades that never arrived",
      value: String(CALLBACK_TIMEOUTS),
      unit: `of ${CALLBACKS_REQUESTED}`,
      note: CALLBACK_TIMEOUTS === 0 ? "Every trade the contract sent reached Base Sepolia." : "Trades the contract sent that never reached Base Sepolia.",
    },
    {
      label: "Fees saved by checking first",
      value: String(ETH_SAVED_PERCENT),
      unit: "%",
      note: `Same ${FILTERED.executed} trades made, ${UNFILTERED.wasted} wasted ones avoided.`,
    },
  ];

  return (
    <>
      <section className={styles.heroSection} aria-labelledby="hero-title">
        <div className={styles.hero}>
          <div className={styles.heroCopy}>
            <h1 id="hero-title" className={`display ${styles.headline}`}>
              Spots a price gap and trades it in {seconds(P50_MS)} seconds.
            </h1>
            <p className="body-lg">
              When two pools price the same token differently, buying on the cheaper one and selling on the other
              makes a profit. Nervo watches for that gap and makes the trade by itself, across two blockchains, with
              no server or bot behind it.
            </p>
            <div className={styles.actions}>
              <Link href="/trade" className="btn primary">
                Try a swap
              </Link>
              <Link href="/evidence" className="btn">
                See the proof
              </Link>
            </div>
            <p className={styles.fine}>
              Measured on test networks with test tokens. Built for the Reactive Omni Buildathon, Every Second Counts
              track.
            </p>
          </div>

          <figure className={`panel ${styles.run}`} aria-labelledby="run-title">
            <div className="panel-head">
              <figcaption id="run-title" className="small muted">
                One real run, step by step
              </figcaption>
              <span className="badge ok">
                <span aria-hidden="true">✓</span>
                Trade done
              </span>
            </div>
            <ol className={styles.runSteps}>
              <RunStep chain="base" block={SAMPLE.originBlock} title="Someone swapped on Pool B" code="ConstantProductPool.swap" hash={SAMPLE.originTx} />
              <RunStep chain="lasna" block={SAMPLE.lasnaBlock} title="The contract decided: worth trading" code="CallbackRequested" hash={SAMPLE.lasnaTx} />
              <RunStep chain="base" block={SAMPLE.callbackBlock} title="The trade was made, profit kept" code="Executed" hash={SAMPLE.callbackTx} isLast />
            </ol>
            <div className={styles.runTotal}>
              <span className="small muted">
                This run, swap to trade: {BASE_BLOCKS_LATER} Base blocks later
              </span>
              <span className={`num ${styles.runTime}`}>
                {seconds(SAMPLE.latencyMs)} <span className={styles.unit}>seconds</span>
              </span>
            </div>
          </figure>
        </div>
      </section>

      <section className={styles.band} aria-label="Measured results">
        <div className={styles.metrics}>
          {metrics.map((metric) => (
            <div key={metric.label} className={styles.metric}>
              <span className="small muted">{metric.label}</span>
              <span className="metric">
                {metric.value} <span className="unit">{metric.unit}</span>
              </span>
              <span className={styles.fine}>{metric.note}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.band} aria-labelledby="uses-title">
        <h2 id="uses-title" className="h2">
          One loop, two ways to use it.
        </h2>
        <div className={styles.uses}>
          <article className={`panel ${styles.use} ${styles.useWide}`}>
            <span className={styles.useLabel}>Cross-chain arbitrage · Base Sepolia and Reactive Lasna</span>
            <h3 className="h3">Make a price gap yourself, then watch the contract answer it.</h3>
            <p className="muted">
              Pick one of the two pools and swap test USDC. Your swap pulls that pool&apos;s price away from the other
              one. The contract on Reactive Lasna sees it, checks whether the gap pays for the fees, and trades it back
              on Base Sepolia. The page follows each step as it lands.
            </p>
            <ol className="progress" aria-label="What you do">
              {ARB_STEPS.map((step, index) => (
                <li key={step}>
                  <span className="mark" aria-hidden="true">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <div>
              <Link href="/trade" className="btn">
                Open the trade page
              </Link>
            </div>
          </article>
          <article className={`panel ${styles.use}`}>
            <span className={styles.useLabel}>Protective orders · Unichain Sepolia</span>
            <h3 className="h3">A stop-loss that watches another chain.</h3>
            <p className="muted">
              Your order waits on Unichain Sepolia and fills when the price on Base Sepolia reaches your trigger. No
              keeper or server watches the price.
            </p>
            <p className={styles.useStat}>
              <span className={`num ${styles.runTime}`}>
                {seconds(ORDER_LATENCY.p50Ms)} <span className={styles.unit}>s</span>
              </span>
              <span className={styles.fine}>
                median trigger to fill, p95 {seconds(ORDER_LATENCY.p95Ms)} s, {ORDER_LATENCY.filled} of{" "}
                {ORDER_LATENCY.samples} stop-losses filled
              </span>
            </p>
            <div className={styles.pushDown}>
              <Link href="/orders" className="btn">
                Set a protective order
              </Link>
            </div>
          </article>
        </div>
      </section>

      <section className={styles.checks} aria-labelledby="checks-title">
        <div className={styles.split}>
          <div className={styles.lead}>
            <h2 id="checks-title" className="h2">
              It checks twice before any money moves.
            </h2>
            <p className="muted">
              Each check leaves a public record of what was decided and why. The names in code are those records,
              exactly as they appear on the chain. A cancelled trade is recorded too, so you can always see what
              happened.
            </p>
          </div>
          <div className={styles.decisions}>
            {DECISIONS.map((decision) => (
              <div key={decision.label} className={styles.decision}>
                <div className={styles.decisionHead}>
                  <span className={`chain-tag ${styles.useLabel}`}>
                    <ChainMark chain={decision.chain} />
                    {decision.label} · on {CHAIN_NAME[decision.chain]}
                  </span>
                  <h3 className={styles.decisionTitle}>{decision.title}</h3>
                  <p className="small muted">{decision.body}</p>
                </div>
                <dl className={styles.events}>
                  {decision.events.map((event) => (
                    <div key={event.name} className={styles.event}>
                      <dt className="mono">{event.name}</dt>
                      <dd className="small muted">{event.meaning}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.band} aria-labelledby="compare-title">
        <div className={styles.split}>
          <div className={styles.lead}>
            <span className="small muted">Does checking first help?</span>
            <h2 id="compare-title" className="h2">
              Same trades, far fewer wasted ones.
            </h2>
            <p className="muted">
              We ran the same {COMPARE_STEPS} price changes through a second copy that skips the first check and sends
              every possible trade. Both made the same {FILTERED.executed} trades. The copy without the check also sent{" "}
              {UNFILTERED.wasted} that were cancelled on arrival, and paid Base Sepolia fees for each.
            </p>
            <Link href="/evidence#comparison" className="link-row">
              See the full numbers
            </Link>
          </div>
          <div className={styles.body}>
            <CompareBars />
          </div>
        </div>
      </section>

      <section className={styles.band} id="contracts" aria-labelledby="contracts-title">
        <div className={styles.sectionHead}>
          <h2 id="contracts-title" className="h2">
            Everything is public on the test networks.
          </h2>
          <p className="muted">Open any address on its chain&apos;s explorer and read every decision the loop made.</p>
        </div>
        <ContractTable rows={MAIN_STACK} />
      </section>
    </>
  );
}

interface RunStepProps {
  chain: ChainKey;
  block: number;
  title: string;
  /** Contract call or event name for this step, exactly as the chain records it. */
  code: string;
  hash: string;
  isLast?: boolean;
}

function RunStep({ chain, block, title, code, hash, isLast = false }: RunStepProps) {
  return (
    <li className={styles.runStep}>
      <div className={styles.rail} aria-hidden="true">
        <span className={styles.check}>✓</span>
        {isLast ? null : <span className={styles.line} />}
      </div>
      <div className={styles.runBody}>
        <div className={styles.runMeta}>
          <span className="chain-tag">
            <ChainMark chain={chain} />
            {CHAIN_NAME[chain]}
          </span>
          <span className="mono num">Block {block.toLocaleString("en-US")}</span>
        </div>
        <span className={styles.runTitle}>
          {title}
          <span className="sr-only"> (done)</span>
        </span>
        <div className={styles.runCode}>
          <code className="mono">{code}</code>
          <HashLink chain={chain} hash={hash} />
        </div>
      </div>
    </li>
  );
}
