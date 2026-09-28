import { useMemo, type CSSProperties } from "react";
import { BLOCKED_FILL, YN_OPTIONS, conditionalFill, evaluate, parseInput, showValue, type CellValue } from "../../lib/fuelPumpReport";
import { buildFuelPumpRows, type FuelCell } from "../../lib/fuelPumpSheet";
import "./validationReport.css";

interface FuelPumpSheetProps {
  cells: Record<string, CellValue>;
  readOnly?: boolean;
  onChange: (addr: string, value: CellValue) => void;
}

type Slot = FuelCell | "covered" | "empty" | "gap";

function occupy(grid: Slot[][], row: number, spec: FuelCell) {
  for (let dc = 0; dc < spec.span; dc += 1) {
    const target = grid[row - 1];
    if (!target) continue;
    target[spec.col - 1 + dc] = dc === 0 ? spec : "covered";
  }
}

function shownText(spec: FuelCell, cells: Record<string, CellValue>, calculated: Record<string, CellValue>): string {
  if (spec.kind === "label") return spec.text ?? "";
  if (spec.kind === "calc") return showValue(calculated[spec.addr] ?? null);
  if (spec.kind === "check" || spec.kind === "blocked" || spec.kind === "spacer") return "";
  const value = cells[spec.addr];
  return showValue(value ?? "");
}

export function FuelPumpSheet({ cells, readOnly = false, onChange }: FuelPumpSheetProps) {
  const rows = useMemo(() => buildFuelPumpRows(), []);
  const calculated = useMemo(() => evaluate(cells), [cells]);
  const grid = useMemo(() => {
    const next: Slot[][] = Array.from({ length: 61 }, () => Array.from({ length: 13 }, () => "gap" as Slot));
    rows.forEach((specs, index) => {
      for (const spec of specs) occupy(next, index + 1, spec);
    });
    for (let r = 0; r < 61; r += 1) {
      for (let c = 0; c < 8; c += 1) {
        if (next[r]![c] === "gap") next[r]![c] = "empty";
      }
    }
    return next;
  }, [rows]);

  return (
    <div className="fp-wrap">
      <table className="fp" data-testid="fuel-pump-sheet" aria-label="Fuel Pump Validation Document">
        <colgroup>
          <col className="f-a" />
          <col className="f-b" />
          <col className="f-c" />
          <col className="f-d" />
          <col className="f-e" />
          <col className="f-f" />
          <col className="f-g" />
          <col className="f-h" />
          <col className="f-i" />
          <col className="f-j" />
          <col className="f-k" />
          <col className="f-l" />
          <col className="f-m" />
        </colgroup>
        <tbody>
          {grid.map((row, rowIndex) => (
            <tr key={rowIndex + 1} className={rowIndex + 1 === 55 ? "short" : undefined}>
              {row.map((slot, colIndex) => {
                if (slot === "covered") return null;
                if (slot === "gap") return <td key={colIndex} className="gap" />;
                if (slot === "empty") return <td key={colIndex} className="grid" />;
                return <Cell key={slot.addr} spec={slot} cells={cells} calculated={calculated} readOnly={readOnly} onChange={onChange} />;
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
  spec: FuelCell;
  cells: Record<string, CellValue>;
  calculated: Record<string, CellValue>;
  readOnly: boolean;
  onChange: (addr: string, value: CellValue) => void;
}) {
  const text = shownText(spec, cells, calculated);
  const cf = spec.kind === "blocked" || spec.kind === "check" || spec.kind === "spacer" ? null : conditionalFill(spec.addr, text);
  const badge = spec.addr === "J1" || spec.addr === "J2";
  const className = [
    spec.kind === "spacer" || (spec.col >= 9 && !badge) ? "gap" : "grid",
    spec.size === "title" ? "title" : "",
    spec.size === "section" ? "section" : "",
    spec.size === "note" ? "note" : "",
    spec.size === "result" ? "result" : "",
    spec.kind === "label" && !spec.size ? "label" : "",
    spec.kind === "blocked" ? "blocked" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const style: CSSProperties = {};
  if (spec.kind === "blocked") {
    style.background = BLOCKED_FILL;
  } else if (cf) {
    style.background = cf;
    style.color = "#111";
  }
  const value = cells[spec.addr];
  const inputValue = value === undefined || value === null || typeof value === "boolean" ? "" : String(value);

  return (
    <td className={className} style={style} colSpan={spec.span > 1 ? spec.span : undefined} data-addr={spec.addr}>
      {spec.kind === "input" && (
        <input
          className="fp-in"
          type={spec.inputType ?? "text"}
          aria-label={spec.addr}
          value={inputValue}
          disabled={readOnly}
          onChange={(event) => onChange(spec.addr, spec.numeric ? parseInput(event.target.value) : event.target.value)}
        />
      )}
      {spec.kind === "area" && (
        <textarea
          className="fp-in"
          aria-label={spec.addr}
          value={inputValue}
          disabled={readOnly}
          onChange={(event) => onChange(spec.addr, event.target.value)}
        />
      )}
      {spec.kind === "select" && (
        <select
          className="fp-in"
          aria-label={spec.addr}
          value={inputValue}
          disabled={readOnly}
          onChange={(event) => onChange(spec.addr, event.target.value)}
        >
          <option value="" />
          {YN_OPTIONS.map((option) => (
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
      {spec.kind === "calc" && <span data-result={spec.addr === "J2" || spec.addr === "B51" ? text : undefined}>{text}</span>}
      {(spec.kind === "label" || spec.kind === "blocked" || spec.kind === "spacer") && text}
    </td>
  );
}
