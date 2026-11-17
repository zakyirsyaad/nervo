import { CHAIN_LABEL } from "@/config/chains";
import type { ContractRow } from "@/config/contracts";
import { ChainMark } from "./ChainMark";
import { HashLink } from "./HashLink";

interface ContractTableProps {
  rows: readonly ContractRow[];
  /** One sentence under the table, for anything in it that would otherwise look like a mistake. */
  note?: string;
}

export function ContractTable({ rows, note }: ContractTableProps) {
  return (
    <div className="panel">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Contract</th>
              <th scope="col">Chain</th>
              <th scope="col">Address</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.chain}-${row.name}`}>
                <td>{row.name}</td>
                <td className="muted">
                  <span className="chain-tag">
                    <ChainMark chain={row.chain} />
                    {CHAIN_LABEL[row.chain]}
                  </span>
                </td>
                <td className="address">
                  <HashLink chain={row.chain} hash={row.address} kind="address" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note ? <p className="table-note small muted">{note}</p> : null}
    </div>
  );
}
