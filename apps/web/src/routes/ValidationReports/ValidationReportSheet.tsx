import { useMemo, type CSSProperties } from "react";
import { conditionalFill, evaluate, parseInput, showValue, type CellValue } from "../../lib/validationReport";
import { buildSheetRows, type SheetCell } from "../../lib/validationReportSheet";
import "./validationReport.css";

interface ValidationReportSheetProps {
  cells: Record<string, CellValue>;
  readOnly?: boolean;
  onChange: (addr: string, value: CellValue) => void;
  documentNumber?: string;
  revision?: string;
}

type Slot = SheetCell | "covered" | "empty" | "gap";

function occupy(grid: Slot[][], row: number, spec: SheetCell) {
  const rowSpan = spec.rowSpan ?? 1;
  for (let dr = 0; dr < rowSpan; dr += 1) {
    for (let dc = 0; dc < spec.span; dc += 1) {
      const target = grid[row - 1 + dr];
      if (!target) continue;
      target[spec.col - 1 + dc] = dr === 0 && dc === 0 ? spec : "covered";
    }
  }
}

function shownText(spec: SheetCell, cells: Record<string, CellValue>, calculated: Record<string, CellValue>, documentNumber: string, revision: string): string {
  if (spec.kind === "label") {
    const raw = spec.text ?? "";
    if (raw.startsWith("Doc ID:")) return documentNumber.trim() ? `Doc ID: ${documentNumber.trim()}` : "Doc ID:";
    if (/^Rev:\s/.test(raw)) return `Rev: ${revision}`;
    return raw;
  }
  if (spec.kind === "calc") return showValue(spec.addr, calculated[spec.addr] ?? null);
  if (spec.kind === "check") return "";
  if (spec.kind === "gray" || spec.kind === "empty") return "";
  return showValue(spec.addr, cells[spec.addr] ?? "");
}

export function ValidationReportSheet({ cells, readOnly = false, onChange, documentNumber = "", revision = "C" }: ValidationReportSheetProps) {
  const rows = useMemo(() => buildSheetRows(), []);
  const calculated = useMemo(() => evaluate(cells), [cells]);
  const grid = useMemo(() => {
    const next: Slot[][] = Array.from({ length: 53 }, () => Array.from({ length: 10 }, () => "gap" as Slot));
    rows.forEach((specs, index) => {
      for (const spec of specs) occupy(next, index + 1, spec);
    });
    for (let r = 0; r < 53; r += 1) {
      for (let c = 0; c < 7; c += 1) {
        if (next[r]![c] === "gap") next[r]![c] = "empty";
      }
    }
    return next;
  }, [rows]);

  return (
    <div className="csa-wrap">
      <div
        className="csa csa-sheet"
        data-testid="validation-report-sheet"
        role="table"
        aria-label="CSA VALIDATION REPORT"
        style={{ display: "grid", gridTemplateColumns: "300px 128px 128px 136px 136px 136px 136px 16px 28px 176px", width: "max-content" }}
      >
        {grid.map((row, rowIndex) =>
          row.map((slot, colIndex) => {
            if (slot === "covered" || slot === "gap") return null;
            const place: CSSProperties = { gridColumn: colIndex + 1, gridRow: rowIndex + 1 };
            if (slot === "empty") return <div key={`e-${rowIndex}-${colIndex}`} className="csa-cell" style={place} />;
            return (
              <Cell
                key={slot.addr}
                spec={slot}
                place={place}
                cells={cells}
                calculated={calculated}
                readOnly={readOnly}
                onChange={onChange}
                documentNumber={documentNumber}
                revision={revision}
              />
            );
          }),
        )}
      </div>
    </div>
  );
}

function Cell({
  spec,
  place,
  cells,
  calculated,
  readOnly,
  onChange,
  documentNumber,
  revision,
}: {
  spec: SheetCell;
  place: CSSProperties;
  cells: Record<string, CellValue>;
  calculated: Record<string, CellValue>;
  readOnly: boolean;
  onChange: (addr: string, value: CellValue) => void;
  documentNumber: string;
  revision: string;
}) {
  const text = shownText(spec, cells, calculated, documentNumber, revision);
  const cf = conditionalFill(spec.addr, spec.kind === "calc" || spec.kind === "label" || spec.kind === "input" ? text : "");
  const pastel = spec.fill;
  const className = [
    "csa-cell",
    spec.col === 1 && spec.kind === "label" && spec.size !== "title" && spec.size !== "section" ? "col-a" : "",
    spec.size === "title" ? "title" : "",
    spec.size === "result" ? "result" : "",
    spec.size === "section" ? "section" : "",
    spec.kind === "gray" ? "gray" : "",
    pastel && spec.col === 9 ? "swatch" : "",
    spec.wrap ? "wrap" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const style: CSSProperties = { ...place };
  if (spec.span > 1) style.gridColumn = `${spec.col} / span ${spec.span}`;
  if (spec.rowSpan && spec.rowSpan > 1) style.gridRow = `${place.gridRow} / span ${spec.rowSpan}`;
  if (cf) {
    style.background = cf;
    style.color = "#111";
  } else if (pastel) {
    style.background = pastel;
    style.color = "#111";
  }

  const value = cells[spec.addr];
  const inputValue = value === undefined || value === null ? "" : typeof value === "boolean" ? "" : String(value);

  return (
    <div className={className} style={style} role="cell" data-addr={spec.addr}>
      {spec.kind === "input" && (
        <input
          className="csa-in"
          type={spec.inputType ?? "text"}
          aria-label={spec.addr}
          value={inputValue}
          disabled={readOnly}
          onChange={(event) => onChange(spec.addr, parseInput(event.target.value))}
        />
      )}
      {spec.kind === "area" && (
        <textarea
          className="csa-in"
          aria-label="Notes"
          value={inputValue}
          disabled={readOnly}
          onChange={(event) => onChange(spec.addr, event.target.value)}
        />
      )}
      {spec.kind === "select" && (
        <select
          className="csa-in"
          aria-label={spec.addr}
          value={inputValue}
          disabled={readOnly}
          onChange={(event) => onChange(spec.addr, event.target.value)}
        >
          <option value="" />
          {(spec.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )}
      {spec.kind === "check" && (
        <input
          type="checkbox"
          aria-label={spec.addr}
          checked={value === true}
          disabled={readOnly}
          onChange={(event) => onChange(spec.addr, event.target.checked)}
        />
      )}
      {spec.kind === "calc" && <span data-result={spec.addr === "A1" ? text : undefined}>{text}</span>}
      {(spec.kind === "label" || spec.kind === "gray" || spec.kind === "empty") && text}
    </div>
  );
}
