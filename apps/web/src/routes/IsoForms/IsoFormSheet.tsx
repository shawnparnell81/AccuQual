import { useMemo, type CSSProperties } from "react";
import type { FormCell, FormLayout } from "../../lib/isoFormLayouts";
import { resultFill, showCell, type CellValue } from "../../lib/isoFormLogic";
import { documentIdText, sheetRevision } from "../../lib/formDocument";
import "./isoForm.css";

interface IsoFormSheetProps {
  layout: FormLayout;
  cells: Record<string, CellValue>;
  calculated?: Record<string, CellValue>;
  readOnly?: boolean;
  onChange: (addr: string, value: CellValue) => void;
  label: string;
  documentNumber?: string;
  revision?: string;
}

type Slot = FormCell | "covered" | "empty";

function occupy(grid: Slot[][], row: number, spec: FormCell) {
  for (let dc = 0; dc < spec.span; dc += 1) {
    const line = grid[row - 1];
    if (!line) continue;
    line[spec.col - 1 + dc] = dc === 0 ? spec : "covered";
  }
}

export function IsoFormSheet({ layout, cells, calculated = {}, readOnly = false, onChange, label, documentNumber = "", revision = "A" }: IsoFormSheetProps) {
  const rowCount = layout.rows.length - 1;
  const grid = useMemo(() => {
    const next: Slot[][] = Array.from({ length: rowCount }, () => Array.from({ length: layout.columns }, () => "empty" as Slot));
    layout.rows.forEach((specs, index) => {
      if (!specs || index === 0) return;
      for (const spec of specs) occupy(next, index, spec);
    });
    return next;
  }, [layout, rowCount]);

  return (
    <div className="iso-wrap">
      <table className="iso" data-testid="iso-form-sheet" aria-label={label}>
        <colgroup>
          {layout.widths.map((width, index) => (
            <col key={index} style={{ width }} />
          ))}
        </colgroup>
        <tbody>
          {grid.map((row, rowIndex) => {
            const specs = layout.rows[rowIndex + 1];
            const blank = !specs || specs.length === 0;
            return (
              <tr key={rowIndex + 1} className={blank ? "blank" : undefined}>
                {blank
                  ? <td colSpan={layout.columns} />
                  : row.map((slot, colIndex) => {
                      if (slot === "covered") return null;
                      if (slot === "empty") return <td key={colIndex} />;
                      return <Cell key={slot.addr} spec={slot} cells={cells} calculated={calculated} readOnly={readOnly} onChange={onChange} documentNumber={documentNumber} revision={revision} />;
                    })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Cell({
  spec,
  cells,
  calculated,
  readOnly,
  onChange,
  documentNumber,
  revision,
}: {
  spec: FormCell;
  cells: Record<string, CellValue>;
  calculated: Record<string, CellValue>;
  readOnly: boolean;
  onChange: (addr: string, value: CellValue) => void;
  documentNumber: string;
  revision: string;
}) {
  const stored = cells[spec.addr];
  const raw = spec.kind === "label" ? spec.text ?? "" : spec.kind === "calc" ? showCell(calculated[spec.addr]) : showCell(stored);
  const text =
    spec.kind !== "label"
      ? raw
      : raw === "Rev: A"
        ? sheetRevision(documentNumber, revision)
        : /^Rev:\s\S+$/.test(raw)
          ? `Rev: ${revision}`
          : documentIdText(raw, documentNumber, spec.documentSlot === true);
  const fill = spec.paint || (spec.kind === "select" ? resultFill(text) : "");
  const className = [spec.role ?? "", spec.align ?? "", spec.kind === "area" ? "area" : "", fill].filter(Boolean).join(" ");
  const style: CSSProperties = {};
  const inputValue = stored == null || typeof stored === "boolean" ? "" : String(stored);

  return (
    <td className={className || undefined} style={style} colSpan={spec.span > 1 ? spec.span : undefined} data-addr={spec.addr}>
      {spec.kind === "input" && (
        <input className="iso-in" aria-label={spec.addr} placeholder={spec.placeholder} value={inputValue} disabled={readOnly} onChange={(event) => onChange(spec.addr, event.target.value)} />
      )}
      {spec.kind === "date" && (
        <input className="iso-in" type="date" aria-label={spec.addr} value={inputValue} disabled={readOnly} onChange={(event) => onChange(spec.addr, event.target.value)} />
      )}
      {spec.kind === "number" && (
        <input className="iso-in" inputMode="decimal" aria-label={spec.addr} placeholder={spec.placeholder} value={inputValue} disabled={readOnly} onChange={(event) => onChange(spec.addr, event.target.value === "" ? "" : Number(event.target.value))} />
      )}
      {spec.kind === "select" && (
        <select className="iso-in" aria-label={spec.addr} value={inputValue} disabled={readOnly} onChange={(event) => onChange(spec.addr, event.target.value)}>
          <option value="" />
          {(spec.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )}
      {spec.kind === "check" && (
        <label className="check">
          <input
            type="checkbox"
            aria-label={spec.addr}
            checked={stored === true}
            disabled={readOnly || (spec.enableWhen != null && cells[spec.enableWhen] !== true)}
            onChange={(event) => onChange(spec.addr, event.target.checked)}
          />
          <span>{spec.text}</span>
        </label>
      )}
      {spec.kind === "area" && (
        <textarea className="iso-in" aria-label={spec.addr} placeholder={spec.placeholder} value={inputValue} disabled={readOnly} onChange={(event) => onChange(spec.addr, event.target.value)} />
      )}
      {(spec.kind === "label" || spec.kind === "calc") && text}
    </td>
  );
}
