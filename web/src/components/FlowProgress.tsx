export interface FlowStep {
  readonly label: string;
  readonly isDone: boolean;
}

interface FlowProgressProps {
  steps: readonly FlowStep[];
  label: string;
}

/** Where the visitor is in a short flow. The first step that is not done is the current one. */
export function FlowProgress({ steps, label }: FlowProgressProps) {
  const currentIndex = steps.findIndex((step) => !step.isDone);

  return (
    <ol className="progress" aria-label={label}>
      {steps.map((step, index) => {
        const isCurrent = index === currentIndex;
        const stateText = step.isDone ? "done" : isCurrent ? "current step" : "not yet";
        return (
          <li key={step.label} className={step.isDone ? "done" : undefined} aria-current={isCurrent ? "step" : undefined}>
            <span className="mark" aria-hidden="true">
              {step.isDone ? "✓" : index + 1}
            </span>
            {step.label}
            <span className="sr-only">, {stateText}</span>
          </li>
        );
      })}
    </ol>
  );
}
