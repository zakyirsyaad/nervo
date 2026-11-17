import Link from "next/link";
import { ChainMark } from "@/components/ChainMark";
import { CompareTable } from "@/components/CompareTable";
import { ContractTable } from "@/components/ContractTable";
import { HashLink } from "@/components/HashLink";
import { CHAIN_NAME, type ChainKey } from "@/config/chains";
import { MAIN_STACK } from "@/config/contracts";
import {
  CALLBACK_TIMEOUTS,
  CALLBACKS_REQUESTED,
  ETH_SAVED_PERCENT,
  FILTERED,
  LATENCIES_MS,
  LATENCY_SAMPLES,
  UNFILTERED,
} from "@/data/evidence";
import { percentile } from "@/lib/latency";
import styles from "./home.module.css";

const P50_MS = percentile(LATENCIES_MS, 50) ?? 0;
const P95_MS = percentile(LATENCIES_MS, 95) ?? 0;
const WITHIN_P95_COUNT = LATENCIES_MS.filter((latency) => latency <= P95_MS).length;
const SAMPLE = LATENCY_SAMPLES[0];

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
    body: "If the difference is too small to cover fees, it stops here and nothing is sent. That keeps costs down.",
    events: [
      { name: "CallbackRequested", meaning: "Yes, send the trade" },
      { name: "MarginBelowThreshold", meaning: "No, the difference is too small" },
      { name: "ExecutorSwap", meaning: "That was our own trade, ignore it" },
    ],
  },
  {
    chain: "base",
    label: "Second check",
    title: "Is it still worth it now?",
    body: "Prices can change in the second or two the trade takes to arrive. So the trade is checked again against the latest prices before any money moves.",
    events: [
      { name: "Executed", meaning: "Traded, profit kept" },
      { name: "SkippedMarginGone", meaning: "Too late, safely cancelled" },
    ],
  },
];

function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(1);
}

export default function HomePage() {
  const metrics = [
    { label: "Typical speed", value: formatSeconds(P50_MS), unit: "seconds", note: `From a swap to the trade that answers it. Middle value of ${LATENCIES_MS.length} runs.` },
    { label: "Slow end", value: formatSeconds(P95_MS), unit: "seconds", note: `${WITHIN_P95_COUNT} of ${LATENCIES_MS.length} runs finished within this time.` },
    {
      label: "Trades that never arrived",
      value: String(CALLBACK_TIMEOUTS),
      unit: `of ${CALLBACKS_REQUESTED}`,
      note: CALLBACK_TIMEOUTS === 0 ? "Every trade the contract sent reached Base Sepolia." : "Trades the contract sent that never reached Base Sepolia.",
    },
    { label: "Fees saved", value: `${ETH_SAVED_PERCENT}`, unit: "%", note: "By checking first and not sending trades that would be cancelled anyway." },
  ];

  return (
    <>
      <section className="section">
        <div className={`container ${styles.hero}`}>
          <div className={`stack loose ${styles.heroCopy}`}>
            <h1 className="display">Spots a price gap and trades it in {formatSeconds(P50_MS)} seconds.</h1>
            <p className="body-lg">
              When two pools show different prices for the same token, there is a profit in buying on the cheaper one
              and selling on the other. Here a smart contract watches for that and makes the trade by itself, across
              two blockchains, with no server or bot behind it.
            </p>
            <div className={styles.actions}>
              <Link href="/trade" className="btn primary">
                Try it yourself
              </Link>
              <Link href="/evidence" className="btn">
                See the proof
              </Link>
            </div>
            <p className="small faint">
              Measured on test networks with play money. Built for the Reactive Omni Buildathon.
            </p>
          </div>

          <div className={`panel ${styles.heroPanel}`}>
            <div className="panel-head label">
              <span>One real run, step by step</span>
              <span className="ok">Trade done</span>
            </div>
            <MeasuredStep
              index={1}
              chain="base"
              block={SAMPLE.originBlock}
              title="Someone swapped on Pool B"
              code="ConstantProductPool.swap"
              hash={SAMPLE.originTx}
            />
            <MeasuredStep
              index={2}
              chain="lasna"
              block={SAMPLE.lasnaBlock}
              title="The contract said: worth trading"
              code="ArbReactive.react"
              hash={SAMPLE.lasnaTx}
            />
            <MeasuredStep
              index={3}
              chain="base"
              block={SAMPLE.callbackBlock}
              title="The trade was made"
              code="ArbExecutor.executeArb"
              hash={SAMPLE.callbackTx}
              isActive
            />
            <div className={`panel-row ${styles.total}`}>
              <span className="small muted">This run, swap to trade</span>
              <span className="metric">
                {formatSeconds(SAMPLE.latencyMs)} <span className="unit">seconds</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="section" aria-label="Key figures">
        <div className={`cells flush quad ${styles.metrics}`}>
          {metrics.map((metric) => (
            <div key={metric.label} className="cell plain">
              <div className="label">{metric.label}</div>
              <div className="metric">
                {metric.value} <span className="unit">{metric.unit}</span>
              </div>
              <p className="small muted">{metric.note}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="container stack loose">
          <div className="stack">
            <h2 className="h2">It checks twice before any money moves.</h2>
            <p className="body-lg">
              Each check leaves a public record saying what was decided and why. Names like CallbackRequested are
              those records, exactly as they appear on the blockchain.
            </p>
          </div>
          <div className={styles.decisions}>
            {DECISIONS.map((decision) => (
              <div key={decision.label} className="panel">
                <div className={`panel-row stack ${styles.decisionHead}`}>
                  <div className="label chain-tag">
                    <ChainMark chain={decision.chain} />
                    {decision.label} · on {CHAIN_NAME[decision.chain]}
                  </div>
                  <h3 className="h3">{decision.title}</h3>
                  <p className="muted">{decision.body}</p>
                </div>
                {decision.events.map((event) => (
                  <div key={event.name} className={`panel-row ${styles.eventRow}`}>
                    <code className="mono">{event.name}</code>
                    <span className="small muted">{event.meaning}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="small faint">A cancelled trade is recorded too, so you can always see what happened.</p>
        </div>
      </section>

      <section className="section">
        <div className="container split">
          <div className="lead stack">
            <div className="label">Does checking first help?</div>
            <h2 className="h2">Same trades, far fewer wasted ones.</h2>
            <p className="muted">
              We built a second copy that skips the first check and sends every possible trade, then ran the same 12
              price changes through both.
            </p>
            <p className="muted">
              Both made the same {FILTERED.executed} trades. The copy without the check also sent {UNFILTERED.wasted}{" "}
              that were cancelled on arrival, and paid fees for each of them.
            </p>
            <Link href="/evidence#comparison" className="link-row">
              See the full numbers →
            </Link>
          </div>
          <div className="body">
            <CompareTable variant="summary" />
          </div>
        </div>
      </section>

      <section className="section" aria-label="Protective orders">
        <div className="container tight">
          <div className={`panel ${styles.protect}`}>
            <div className="stack">
              <h2 className="h3">Use the same loop to protect a position.</h2>
              <p className="muted">
                Set a stop-loss on Unichain Sepolia that reacts to the price on Base Sepolia and fills by itself within
                seconds.
              </p>
            </div>
            <Link href="/orders" className="btn">
              Set a protective order
            </Link>
          </div>
        </div>
      </section>

      <section className="section" id="contracts">
        <div className="container stack loose">
          <h2 className="h2">Everything is public on the test networks.</h2>
          <ContractTable rows={MAIN_STACK} />
        </div>
      </section>
    </>
  );
}

interface MeasuredStepProps {
  index: number;
  chain: ChainKey;
  block: number;
  title: string;
  /** Contract function that ran in this step. */
  code: string;
  hash: string;
  isActive?: boolean;
}

function MeasuredStep({ index, chain, block, title, code, hash, isActive = false }: MeasuredStepProps) {
  return (
    <div className={`panel-row stack ${styles.step} ${isActive ? "active" : ""}`}>
      <div className={`label ${styles.stepMeta} ${isActive ? "accent" : ""}`}>
        <span className="chain-tag">
          <ChainMark chain={chain} />
          {index} · {CHAIN_NAME[chain]}
        </span>
        <span className="mono num">Block {block}</span>
      </div>
      <div className={styles.stepBody}>
        <span>{title}</span>
        <HashLink chain={chain} hash={hash} />
      </div>
      <code className="mono faint">{code}</code>
    </div>
  );
}
