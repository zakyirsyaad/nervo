import { COMPARE_STEPS, FILTERED, UNFILTERED, type StackResult } from "@/data/evidence";

interface CompareRow {
  readonly label: string;
  readonly value: (stack: StackResult) => string;
  readonly isDetail?: boolean;
}

const ETH_DIGITS = 7;
const LREACT_DIGITS = 3;

const ROWS: readonly CompareRow[] = [
  { label: "Price changes looked at", value: (stack) => String(stack.logs), isDetail: true },
  { label: "Trades sent", value: (stack) => String(stack.callbacks) },
  { label: "Trades completed", value: (stack) => String(stack.executed) },
  { label: "Trades cancelled on arrival (wasted)", value: (stack) => String(stack.wasted) },
  { label: "Fees paid on Base Sepolia, in ETH", value: (stack) => stack.ethSpent.toFixed(ETH_DIGITS) },
  { label: "Fees paid on Reactive, in lREACT", value: (stack) => stack.lreactSpent.toFixed(LREACT_DIGITS), isDetail: true },
  {
    label: "Time taken, typical / slowest",
    value: (stack) => `${(stack.p50Ms / 1000).toFixed(1)} / ${(stack.p95Ms / 1000).toFixed(1)} s`,
    isDetail: true,
  },
];

interface CompareTableProps {
  /** The summary variant hides the rows that only matter on the evidence page. */
  variant?: "summary" | "full";
}

export function CompareTable({ variant = "full" }: CompareTableProps) {
  const rows = variant === "full" ? ROWS : ROWS.filter((row) => !row.isDetail);

  return (
    <div className="panel table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{COMPARE_STEPS} price changes each</th>
            <th scope="col" className="numeric">
              Checks first
            </th>
            <th scope="col" className="numeric">
              No check
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td className="numeric">{row.value(FILTERED)}</td>
              <td className="numeric muted">{row.value(UNFILTERED)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
