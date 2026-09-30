import { useMemo, type CSSProperties } from "react";
import { SignatureStamp } from "../../components/forms/SignatureStamp";
import { AIR_STRUT_CERTIFY, evaluate, parseInput, showValue, statusFill, type CellValue } from "../../lib/airStrutReport";
import { AIR_STRUT_ROWS, buildAirStrutRows, type AirCell } from "../../lib/airStrutSheet";
import "./validationReport.css";

interface AirStrutSheetProps {
  cells: Record<string, CellValue>;
  readOnly?: boolean;
  onChange: (addr: string, value: CellValue) => void;
  documentNumber?: string;
  revision?: string;
  signature?: string;
  onSign?: (pin: string) => Promise<unknown>;
}

type Slot = AirCell | "covered" | "empty";

function occupy(grid: Slot[][], row: number, spec: AirCell) {
  const rowSpan = spec.rowSpan ?? 1;
  for (let dr = 0; dr < rowSpan; dr += 1) {
    for (let dc = 0; dc < spec.span; dc += 1) {
      const line = grid[row - 1 + dr];
      if (!line) continue;
      line[spec.col - 1 + dc] = dr === 0 && dc === 0 ? spec : "covered";
    }
  }
}

function shownText(spec: AirCell, cells: Record<string, CellValue>, calculated: Record<string, CellValue>, documentNumber: string, revision: string): string {
  if (spec.kind === "label") {
    const raw = spec.text ?? "";
    if (raw.startsWith("Doc ID:")) return documentNumber.trim() ? `Doc ID: ${documentNumber.trim()}` : "Doc ID:";
    if (/^Rev:\s/.test(raw)) return `Rev: ${revision}`;
    return raw;
  }
  if (spec.kind === "calc") return showValue(calculated[spec.addr] ?? null);
  return "";
}

export function AirStrutSheet({ cells, readOnly = false, onChange, documentNumber = "", revision = "A", signature = "", onSign }: AirStrutSheetProps) {
  const rows = useMemo(() => buildAirStrutRows(), []);
  const calculated = useMemo(() => evaluate(cells), [cells]);
  const grid = useMemo(() => {
    const next: Slot[][] = Array.from({ length: AIR_STRUT_ROWS }, () => Array.from({ length: 8 }, () => "empty" as Slot));
    rows.forEach((specs, index) => {
      if (!specs) return;
      for (const spec of specs) occupy(next, index, spec);
    });
    return next;
  }, [rows]);

  return (
    <div className="fp-wrap">
      <div className="fp-sheet as-sheet" data-testid="air-strut-sheet" role="table" aria-label="Air Strut Validation Document">
        {grid.map((row, rowIndex) =>
          row.map((slot, colIndex) => {
            if (slot === "covered" || slot === "empty") return null;
            const place: CSSProperties = { gridColumn: `${colIndex + 1} / span ${slot.span}`, gridRow: `${rowIndex + 1} / span ${slot.rowSpan ?? 1}` };
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
                signature={signature}
                onSign={onSign}
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
  signature,
  onSign,
}: {
  spec: AirCell;
  place: CSSProperties;
  cells: Record<string, CellValue>;
  calculated: Record<string, CellValue>;
  readOnly: boolean;
  onChange: (addr: string, value: CellValue) => void;
  documentNumber: string;
  revision: string;
  signature: string;
  onSign?: (pin: string) => Promise<unknown>;
}) {
  const text = shownText(spec, cells, calculated, documentNumber, revision);
  const fill = spec.kind === "calc" ? statusFill(text) : null;
  const className = [
    "fp-cell",
    spec.kind === "spacer" ? "spacer" : "",
    spec.col === 1 && spec.kind === "label" && spec.size !== "title" && spec.size !== "section" && spec.size !== "note" ? "col-a" : "",
    spec.size === "title" ? "title" : "",
    spec.size === "section" ? "section" : "",
    spec.size === "note" ? "note" : "",
    spec.size === "result" ? "result" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const style: CSSProperties = { ...place };
  if (fill) {
    style.background = fill;
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
        <textarea className="fp-in" aria-label={spec.addr} value={inputValue} disabled={readOnly} onChange={(event) => onChange(spec.addr, event.target.value)} />
      )}
      {spec.kind === "check" && (
        <label className="check">
          <input type="checkbox" aria-label={spec.addr} checked={value === true} disabled={readOnly} onChange={(event) => onChange(spec.addr, event.target.checked)} />
          <span>{spec.text}</span>
        </label>
      )}
      {spec.kind === "sign" && (
        <SignatureStamp
          value={signature}
          certify={AIR_STRUT_CERTIFY}
          disabled={readOnly || !onSign}
          variant="sheet"
          onSign={async (pin) => {
            if (onSign) await onSign(pin);
          }}
        />
      )}
      {spec.kind === "calc" && <span data-result={spec.addr === "G7" || spec.addr === "B84" ? text : undefined}>{text}</span>}
      {(spec.kind === "label" || spec.kind === "spacer") && text}
    </div>
  );
}
