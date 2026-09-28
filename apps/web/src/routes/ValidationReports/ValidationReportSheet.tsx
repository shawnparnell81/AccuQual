import { useMemo, type CSSProperties } from "react";
import { conditionalFill, evaluate, parseInput, showValue, type CellValue } from "../../lib/validationReport";
import { buildSheetRows, type SheetCell } from "../../lib/validationReportSheet";
import "./validationReport.css";

interface ValidationReportSheetProps {
  cells: Record<string, CellValue>;
  readOnly?: boolean;
  onChange: (addr: string, value: CellValue) => void;
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

function shownText(spec: SheetCell, cells: Record<string, CellValue>, calculated: Record<string, CellValue>): string {
  if (spec.kind === "label") return spec.text ?? "";
  if (spec.kind === "calc") return showValue(spec.addr, calculated[spec.addr] ?? null);
  if (spec.kind === "check") return "";
  if (spec.kind === "gray" || spec.kind === "empty") return "";
  return showValue(spec.addr, cells[spec.addr] ?? "");
}

export function ValidationReportSheet({ cells, readOnly = false, onChange }: ValidationReportSheetProps) {
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
      <table className="csa" data-testid="validation-report-sheet" aria-label="CSA Validation Report">
        <colgroup>
          <col className="c-a" />
          <col className="c-b" />
          <col className="c-c" />
          <col className="c-d" />
          <col className="c-e" />
          <col className="c-f" />
          <col className="c-g" />
          <col className="c-h" />
          <col className="c-i" />
          <col className="c-j" />
        </colgroup>
        <tbody>
          {grid.map((row, rowIndex) => (
            <tr key={rowIndex + 1}>
              {row.map((slot, colIndex) => {
                if (slot === "covered") return null;
                if (slot === "gap") return <td key={colIndex} className="gap" />;
                if (slot === "empty") return <td key={colIndex} className="grid" />;
                return (
                  <Cell
                    key={slot.addr}
                    spec={slot}
                    cells={cells}
                    calculated={calculated}
                    readOnly={readOnly}
                    onChange={onChange}
                  />
                );
              })}
            </tr>
          ))}
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
}: {
  spec: SheetCell;
  cells: Record<string, CellValue>;
  calculated: Record<string, CellValue>;
  readOnly: boolean;
  onChange: (addr: string, value: CellValue) => void;
}) {
  const text = shownText(spec, cells, calculated);
  const cf = conditionalFill(spec.addr, spec.kind === "calc" || spec.kind === "label" || spec.kind === "input" ? text : "");
  const pastel = spec.fill;
  const className = [
    spec.col <= 7 || spec.kind === "label" ? "grid" : "gap",
    spec.size === "title" ? "title" : "",
    spec.size === "result" ? "result" : "",
    spec.size === "section" ? "section" : "",
    spec.kind === "label" && spec.size !== "title" && spec.size !== "section" ? "label" : "",
    spec.kind === "gray" ? "gray" : "",
    pastel && spec.col === 9 ? "swatch" : "",
    spec.wrap ? "wrap" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const style: CSSProperties = {};
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
    <td
      className={className}
      style={style}
      colSpan={spec.span > 1 ? spec.span : undefined}
      rowSpan={spec.rowSpan && spec.rowSpan > 1 ? spec.rowSpan : undefined}
      data-addr={spec.addr}
    >
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
    </td>
  );
}
