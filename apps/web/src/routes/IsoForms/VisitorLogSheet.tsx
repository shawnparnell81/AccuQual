import { VISITOR_COLUMNS, VISITOR_ROWS, VISITOR_RULES, visitorAddr } from "../../lib/visitorLog";
import type { CellValue } from "../../lib/isoFormLogic";
import "./isoForm.css";

interface VisitorLogSheetProps {
  cells: Record<string, CellValue>;
  readOnly?: boolean;
  onChange: (addr: string, value: CellValue) => void;
  documentNumber?: string;
  revision?: string;
}

function text(value: CellValue | undefined): string {
  return value === undefined || value === null || typeof value === "boolean" ? "" : String(value);
}

export function VisitorLogSheet({ cells, readOnly = false, onChange, documentNumber = "", revision = "A" }: VisitorLogSheetProps) {
  const doc = documentNumber.trim() ? documentNumber.trim() : "";
  return (
    <table className="dense-log" data-testid="visitor-log-sheet" aria-label="DMA Laboratory Visitor Log">
      <tbody>
        <tr>
          <td className="title" colSpan={9}>
            DMA Laboratory Visitor Log
          </td>
        </tr>
        <tr>
          <td>Document ID:</td>
          <td>{doc}</td>
          <td>REV:</td>
          <td>{revision}</td>
          <td>Location:</td>
          <td colSpan={2}>
            <input aria-label="F2" value={text(cells.F2)} disabled={readOnly} onChange={(event) => onChange("F2", event.target.value)} />
          </td>
          <td>Approved By:</td>
          <td>
            <input aria-label="I2" value={text(cells.I2)} disabled={readOnly} onChange={(event) => onChange("I2", event.target.value)} />
          </td>
        </tr>
        <tr>
          <td colSpan={9}>Attention Visitors: By signing below, you agree to the following conditions:</td>
        </tr>
        {VISITOR_RULES.map((rule) => (
          <tr key={rule}>
            <td colSpan={9}>{rule}</td>
          </tr>
        ))}
        <tr>
          {VISITOR_COLUMNS.map((column) => (
            <th key={column.key}>{column.label}</th>
          ))}
        </tr>
        {Array.from({ length: VISITOR_ROWS }, (_, row) => (
          <tr key={row}>
            {VISITOR_COLUMNS.map((column) => {
              const addr = visitorAddr(row, column.key);
              return (
                <td key={addr}>
                  <input
                    aria-label={addr}
                    type={column.type === "text" ? "text" : column.type}
                    value={text(cells[addr])}
                    disabled={readOnly}
                    onChange={(event) => onChange(addr, event.target.value)}
                  />
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
