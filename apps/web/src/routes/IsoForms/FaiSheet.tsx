import { Fragment } from "react";
import type { CellValue } from "../../lib/isoFormLogic";
import { sheetRevision } from "../../lib/formDocument";
import { blankFaiLine, faiFill, faiResult, type FaiLine } from "../../lib/qualitySheetLogic";
import "./isoForm.css";

interface FaiSheetProps {
  cells: Record<string, CellValue>;
  lines: FaiLine[];
  readOnly?: boolean;
  onCell: (addr: string, value: CellValue) => void;
  onLines: (lines: FaiLine[]) => void;
  documentNumber?: string;
  revision?: string;
}

const HEADER: Array<Array<{ label: string; addr: string }>> = [
  [
    { label: "Organization", addr: "B3" },
    { label: "Supplier", addr: "D3" },
    { label: "Part Number", addr: "F3" },
  ],
  [
    { label: "Supplier / Vendor Code", addr: "B4" },
    { label: "Part Name", addr: "D4" },
    { label: "Design Record Change Level", addr: "F4" },
  ],
  [
    { label: "Name of Inspection Facility", addr: "B5" },
    { label: "Inspection Name", addr: "D5" },
    { label: "Engineering Change Documents", addr: "F5" },
  ],
];

function textOf(value: CellValue | undefined): string {
  return value == null || typeof value === "boolean" ? "" : String(value);
}

function visibleLines(lines: FaiLine[]): FaiLine[] {
  if (lines.length > 0) return lines;
  return Array.from({ length: 8 }, (_, index) => ({ ...blankFaiLine(), balloon: String(index + 1) }));
}

export function FaiSheet({ cells, lines, readOnly = false, onCell, onLines, documentNumber = "", revision = "A" }: FaiSheetProps) {
  const rows = visibleLines(lines);

  function commit(next: FaiLine[]) {
    onLines(next);
  }

  function edit(index: number, patch: Partial<FaiLine>) {
    commit(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  return (
    <div className="iso-wrap">
      <table className="iso" data-testid="fai-sheet" aria-label="First Article Inspection Report">
        <tbody>
          <tr>
            <td className="title" colSpan={6}>
              PRODUCTION PART APPROVAL — DIMENSIONAL TEST RESULTS
            </td>
          </tr>
          <tr>
            <td>{sheetRevision(documentNumber, revision)}</td>
            <td colSpan={3}>First Article Inspection Report</td>
            <td>Page</td>
            <td>
              <span className="check">
                <input className="iso-in" aria-label="Page number" value={textOf(cells.G2)} disabled={readOnly} onChange={(event) => onCell("G2", event.target.value)} />
                <span>of</span>
                <input className="iso-in" aria-label="Page count" value={textOf(cells.H2)} disabled={readOnly} onChange={(event) => onCell("H2", event.target.value)} />
              </span>
            </td>
          </tr>
          {HEADER.map((group) => (
            <tr key={group[0]?.addr}>
              {group.map((field) => (
                <Fragment key={field.addr}>
                  <td>{field.label}</td>
                  <td>
                    <input className="iso-in" aria-label={field.label} value={textOf(cells[field.addr])} disabled={readOnly} onChange={(event) => onCell(field.addr, event.target.value)} />
                  </td>
                </Fragment>
              ))}
            </tr>
          ))}
          <tr>
            <td className="section" colSpan={6}>
              DIMENSIONAL TEST RESULTS
            </td>
          </tr>
          <tr>
            <td className="header">Balloon</td>
            <td className="header">Characteristic</td>
            <td className="header">Nominal</td>
            <td className="header">Tolerance</td>
            <td className="header">Actual</td>
            <td className="header">Pass / Fail</td>
          </tr>
          {rows.map((row, index) => {
            const result = faiResult(row.nominal, row.tolerance, row.actual);
            return (
              <tr key={index}>
                <td>
                  <input className="iso-in center" aria-label={`Balloon ${index + 1}`} value={row.balloon} disabled={readOnly} onChange={(event) => edit(index, { balloon: event.target.value })} />
                </td>
                <td>
                  <input className="iso-in" aria-label={`Characteristic ${index + 1}`} value={row.characteristic} disabled={readOnly} onChange={(event) => edit(index, { characteristic: event.target.value })} />
                </td>
                <td>
                  <input className="iso-in center" aria-label={`Nominal ${index + 1}`} value={row.nominal} disabled={readOnly} onChange={(event) => edit(index, { nominal: event.target.value })} />
                </td>
                <td>
                  <input className="iso-in center" aria-label={`Tolerance ${index + 1}`} placeholder="±0.10" value={row.tolerance} disabled={readOnly} onChange={(event) => edit(index, { tolerance: event.target.value })} />
                </td>
                <td>
                  <input className="iso-in center" aria-label={`Actual ${index + 1}`} value={row.actual} disabled={readOnly} onChange={(event) => edit(index, { actual: event.target.value })} />
                </td>
                <td className={faiFill(result)} data-testid={`fai-result-${index}`} aria-label={`Pass or Fail ${index + 1}`}>
                  {result}
                </td>
              </tr>
            );
          })}
          <tr>
            <td colSpan={6} className="note">
              Blanket statements of conformance are unacceptable for any test results.
            </td>
          </tr>
          <tr>
            <td>Signature</td>
            <td>
              <input className="iso-in" aria-label="Signature" value={textOf(cells.B34)} disabled={readOnly} onChange={(event) => onCell("B34", event.target.value)} />
            </td>
            <td>Title</td>
            <td>
              <input className="iso-in" aria-label="Title" value={textOf(cells.D34)} disabled={readOnly} onChange={(event) => onCell("D34", event.target.value)} />
            </td>
            <td>Date</td>
            <td>
              <input className="iso-in" type="date" aria-label="Sign-off date" value={textOf(cells.F34)} disabled={readOnly} onChange={(event) => onCell("F34", event.target.value)} />
            </td>
          </tr>
        </tbody>
      </table>
      {!readOnly && (
        <div className="no-print mt-2 flex gap-2">
          <button type="button" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted" onClick={() => commit([...rows, { ...blankFaiLine(), balloon: String(rows.length + 1) }])}>
            Add characteristic
          </button>
          {rows.length > 1 && (
            <button type="button" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted" onClick={() => commit(rows.slice(0, -1))}>
              Remove last row
            </button>
          )}
        </div>
      )}
    </div>
  );
}
