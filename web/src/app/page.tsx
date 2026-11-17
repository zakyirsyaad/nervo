import Link from "next/link";
import { CompareTable } from "@/components/CompareTable";
import { ContractTable } from "@/components/ContractTable";
import { HashLink } from "@/components/HashLink";
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
const SAMPLE = LATENCY_SAMPLES[0];

const LOOP_STEPS = [
  {
    label: "Step 1 · Base Sepolia",
    title: "Someone swaps",
    body: "Two pools sell the same token. A swap on one of them moves its price, so the two pools no longer agree.",
    code: "ConstantProductPool.swap",
  },
  {
    label: "Step 2 · Reactive",
    title: "A contract notices",
    body: "A contract on the Reactive network is listening. It works out whether buying on the cheaper pool and selling on the other would make at least 2 USDC.",
    code: "ArbReactive.react",
  },
  {
    label: "Step 3 · Base Sepolia",
    title: "The trade happens by itself",
    body: "If it is worth it, the contract sends the trade back. A second contract checks the prices one more time, then buys low and sells high in one go.",
    code: "ArbExecutor.executeArb",
  },
] as const;

const DECISIONS = [
  {
    label: "First check · on Reactive",
    title: "Is it worth trading?",
    body: "If the difference is too small to cover fees, it stops here and nothing is sent. That keeps costs down.",
    events: [
      { name: "CallbackRequested", meaning: "Yes, send the trade" },
      { name: "MarginBelowThreshold", meaning: "No, the difference is too small" },
      { name: "ExecutorSwap", meaning: "That was our own trade, ignore it" },
    ],
  },
  {
    label: "Second check · on Base Sepolia",
    title: "Is it still worth it now?",
    body: "Prices can change in the second or two the trade takes to arrive. So the trade is checked again against the latest prices before any money moves.",
    events: [
      { name: "Executed", meaning: "Traded, profit kept" },
      { name: "SkippedMarginGone", meaning: "Too late, safely cancelled" },
    ],
  },
] as const;

function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(1);
}

export default function HomePage() {
  const metrics = [
    { label: "Typical speed", value: formatSeconds(P50_MS), unit: "seconds", note: `From a swap to the trade that answers it. Middle value of ${LATENCIES_MS.length} runs.` },
    { label: "Slowest run", value: formatSeconds(P95_MS), unit: "seconds", note: "Even the slowest run finished in this time." },
    { label: "Trades that never arrived", value: String(CALLBACK_TIMEOUTS), unit: `of ${CALLBACKS_REQUESTED}`, note: "Every trade the contract sent reached Base Sepolia." },
    { label: "Fees saved", value: `${ETH_SAVED_PERCENT}`, unit: "%", note: "By checking first and not sending trades that would be cancelled anyway." },
  ];

  return (
    <>
      <section className="section">
        <div className={`container ${styles.hero}`}>
          <div className={`stack loose ${styles.heroCopy}`}>
            <div className="label">[ Automatic arbitrage across two chains ]</div>
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
            <div className="panel-head">
              <span className="label">[ A real example ]</span>
              <span className="label ok">Trade done</span>
            </div>
            <MeasuredStep label="1 · Base Sepolia" block={SAMPLE.originBlock} title="Someone swapped on Pool B" chain="base" hash={SAMPLE.originTx} />
            <MeasuredStep label="2 · Reactive" block={SAMPLE.lasnaBlock} title="The contract said: worth trading" chain="lasna" hash={SAMPLE.lasnaTx} />
            <MeasuredStep label="3 · Base Sepolia" block={SAMPLE.callbackBlock} title="The trade was made" chain="base" hash={SAMPLE.callbackTx} isActive />
            <div className={`panel-row ${styles.total}`}>
              <span className="small muted">From swap to trade</span>
              <span className="metric">
                {formatSeconds(SAMPLE.latencyMs)} <span className="unit">seconds</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="section" aria-label="Key figures">
        <div className={`cells flush ${styles.metrics}`}>
          {metrics.map((metric) => (
            <div key={metric.label} className="cell plain">
              <div className="label">[ {metric.label} ]</div>
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
            <div className="label">[ How it works ]</div>
            <h2 className="h2">Three steps, and nobody presses a button.</h2>
            <p className="body-lg">
              Normally a trading bot runs on someone&apos;s server and watches prices all day. Here the watching and
              the deciding are done by a contract on the Reactive network.
            </p>
          </div>
          <ol className={styles.loop}>
            {LOOP_STEPS.map((step) => (
              <li key={step.label} className={`panel ${styles.loopCard}`}>
                <div className="label">[ {step.label} ]</div>
                <h3 className="h3">{step.title}</h3>
                <p className="muted">{step.body}</p>
                <code className="mono faint">{step.code}</code>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section">
        <div className="container stack loose">
          <div className="stack">
            <div className="label">[ Two safety checks ]</div>
            <h2 className="h2">It checks twice before any money moves.</h2>
            <p className="body-lg">
              Each check leaves a public record saying what was decided and why. The names on the right are those
              records, exactly as they appear on the blockchain.
            </p>
          </div>
          <div className={styles.decisions}>
            {DECISIONS.map((decision) => (
              <div key={decision.label} className="panel">
                <div className={`panel-row stack ${styles.decisionHead}`}>
                  <div className="label">[ {decision.label} ]</div>
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
            <div className="label">[ Does checking first help? ]</div>
            <h2 className="h2">Same profit, far fewer wasted trades.</h2>
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

      <section className="section" id="contracts">
        <div className="container stack loose">
          <div className="stack">
            <div className="label">[ Check it yourself ]</div>
            <h2 className="h2">Everything is public on the test networks.</h2>
          </div>
          <ContractTable rows={MAIN_STACK} />
        </div>
      </section>
    </>
  );
}

interface MeasuredStepProps {
  label: string;
  block: number;
  title: string;
  chain: "base" | "lasna";
  hash: string;
  isActive?: boolean;
}

function MeasuredStep({ label, block, title, chain, hash, isActive = false }: MeasuredStepProps) {
  return (
    <div className={`panel-row stack ${styles.step} ${isActive ? "active" : ""}`}>
      <div className={`label ${styles.stepMeta} ${isActive ? "accent" : ""}`}>
        <span>{label}</span>
        <span>Block {block}</span>
      </div>
      <div className={styles.stepBody}>
        <span>{title}</span>
        <HashLink chain={chain} hash={hash} />
      </div>
    </div>
  );
}
