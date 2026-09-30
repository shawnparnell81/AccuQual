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

const FUEL_COLUMNS = "306px 141px 141px 141px 92px 92px 92px 86px 16px 74px 74px";

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
    const next: Slot[][] = Array.from({ length: 61 }, () => Array.from({ length: 11 }, () => "gap" as Slot));
    rows.forEach((specs, index) => {
      for (const spec of specs) {
        if (spec.col > 11) continue;
        occupy(next, index + 1, spec);
      }
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
      <div
        className="fp fp-sheet"
        data-testid="fuel-pump-sheet"
        role="table"
        aria-label="Fuel Pump Validation Document"
        style={{ display: "grid", gridTemplateColumns: FUEL_COLUMNS, width: "max-content" }}
      >
        {grid.map((row, rowIndex) =>
          row.map((slot, colIndex) => {
            if (slot === "covered" || slot === "gap") return null;
            const place: CSSProperties = { gridColumn: colIndex + 1, gridRow: rowIndex + 1 };
            if (slot === "empty") return <div key={`e-${rowIndex}-${colIndex}`} className="fp-cell" style={place} />;
            if (slot.kind === "spacer") return null;
            return <Cell key={slot.addr} spec={slot} place={place} cells={cells} calculated={calculated} readOnly={readOnly} onChange={onChange} />;
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
}: {
  spec: FuelCell;
  place: CSSProperties;
  cells: Record<string, CellValue>;
  calculated: Record<string, CellValue>;
  readOnly: boolean;
  onChange: (addr: string, value: CellValue) => void;
}) {
  const text = shownText(spec, cells, calculated);
  const cf = spec.kind === "blocked" || spec.kind === "check" || spec.kind === "spacer" ? null : conditionalFill(spec.addr, text);
  const className = [
    "fp-cell",
    spec.col === 1 && spec.kind === "label" && spec.size !== "title" && spec.size !== "section" && spec.size !== "note" ? "col-a" : "",
    spec.size === "title" ? "title" : "",
    spec.size === "section" ? "section" : "",
    spec.size === "note" ? "note" : "",
    spec.size === "result" ? "result" : "",
    spec.kind === "blocked" ? "blocked" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const style: CSSProperties = { ...place };
  if (spec.span > 1) style.gridColumn = `${spec.col} / span ${spec.span}`;
  if (spec.kind === "blocked") {
    style.background = BLOCKED_FILL;
  } else if (cf) {
    style.background = cf;
    style.color = "#111";
  }
  const value = cells[spec.addr];
  const inputValue = value === undefined || value === null || typeof value === "boolean" ? "" : String(value);

  return (
    <div className={className} style={style} role="cell" data-addr={spec.addr}>
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
    </div>
  );
}
