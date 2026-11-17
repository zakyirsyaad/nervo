import { HashLink } from "@/components/HashLink";
import type { ChainKey } from "@/config/chains";
import styles from "./trade.module.css";

export type StepState = "done" | "active" | "pending" | "off";

const STEP_MARK: Record<StepState, string> = { done: "✓", active: "●", pending: "", off: "–" };
const STEP_STATE_TEXT: Record<StepState, string> = {
  done: "completed",
  active: "in progress",
  pending: "not started",
  off: "did not happen",
};

interface TimelineStepProps {
  index: string;
  state: StepState;
  title: string;
  /** One plain sentence about the step. */
  detail: string;
  /** Technical reference for people who want to check it on an explorer. */
  tech?: string;
  link?: { chain: ChainKey; hash: string };
}

/** One row of a cross-chain timeline, shared by the swap tracker and the order tracker. */
export function TimelineStep({ index, state, title, detail, tech, link }: TimelineStepProps) {
  return (
    <li className={`${styles.stepRow} ${styles[state]}`} aria-current={state === "active" ? "step" : undefined}>
      <span className={`mono ${styles.stepIndex}`}>
        {index}{" "}
        <span aria-hidden="true" className={state === "active" ? "pulse" : undefined}>
          {STEP_MARK[state]}
        </span>
        <span className="sr-only">{STEP_STATE_TEXT[state]}</span>
      </span>
      <div className={styles.stepText}>
        <span className={styles.stepTitle}>{title}</span>
        <span className="small muted">{detail}</span>
        {tech ? <span className={styles.stepTech}>{tech}</span> : null}
      </div>
      {link ? <HashLink chain={link.chain} hash={link.hash} /> : null}
    </li>
  );
}
