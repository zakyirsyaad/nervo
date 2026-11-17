import { CHAIN_LABEL } from "@/config/chains";
import type { ContractRow } from "@/config/contracts";
import { HashLink } from "./HashLink";

interface ContractTableProps {
  rows: readonly ContractRow[];
}

export function ContractTable({ rows }: ContractTableProps) {
  return (
    <div className="panel table-wrap">
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
              <td className="muted">{CHAIN_LABEL[row.chain]}</td>
              <td className="address">
                <HashLink chain={row.chain} hash={row.address} kind="address" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
