import { useMemo, type CSSProperties } from "react";
import { SignatureStamp } from "../../components/forms/SignatureStamp";
import { choiceOf, showsRequiredControl, type SignatureChoice } from "../../components/forms/signatureRequired";
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
  signatures?: Record<string, string>;
  onSign?: (field: string, pin: string) => Promise<unknown>;
  signatureRequired?: Record<string, SignatureChoice>;
  onSignatureRequired?: (path: string, choice: SignatureChoice) => void;
}

type Slot = FormCell | "covered" | "empty";

function occupy(grid: Slot[][], row: number, spec: FormCell) {
  for (let dc = 0; dc < spec.span; dc += 1) {
    const line = grid[row - 1];
    if (!line) continue;
    line[spec.col - 1 + dc] = dc === 0 ? spec : "covered";
  }
}

function signatureCount(layout: FormLayout): number {
  let count = 0;
  for (const row of layout.rows) {
    if (!row) continue;
    for (const cell of row) if (cell.kind === "signature" && cell.signatureKey) count += 1;
  }
  return count;
}

export function IsoFormSheet({ layout, cells, calculated = {}, readOnly = false, onChange, label, documentNumber = "", revision = "A", signatures = {}, onSign, signatureRequired, onSignatureRequired }: IsoFormSheetProps) {
  const multi = showsRequiredControl(signatureCount(layout));
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
                      return <Cell key={slot.addr} spec={slot} cells={cells} calculated={calculated} readOnly={readOnly} onChange={onChange} documentNumber={documentNumber} revision={revision} signatures={signatures} onSign={onSign} multi={multi} signatureRequired={signatureRequired} onSignatureRequired={onSignatureRequired} />;
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
  signatures,
  onSign,
  multi,
  signatureRequired,
  onSignatureRequired,
}: {
  spec: FormCell;
  cells: Record<string, CellValue>;
  calculated: Record<string, CellValue>;
  readOnly: boolean;
  onChange: (addr: string, value: CellValue) => void;
  documentNumber: string;
  revision: string;
  signatures: Record<string, string>;
  onSign?: (field: string, pin: string) => Promise<unknown>;
  multi: boolean;
  signatureRequired?: Record<string, SignatureChoice>;
  onSignatureRequired?: (path: string, choice: SignatureChoice) => void;
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
  const className = [spec.role ?? "", spec.align ?? "", spec.kind === "area" ? "area" : "", spec.kind === "signature" ? "sig" : "", spec.kind === "calc" ? "calc" : "", fill].filter(Boolean).join(" ");
  const style: CSSProperties = {};
  const inputValue = stored == null || typeof stored === "boolean" ? "" : String(stored);

  return (
    <td className={className || undefined} style={style} colSpan={spec.span > 1 ? spec.span : undefined} data-addr={spec.addr} title={spec.kind === "calc" ? "calc" : undefined}>
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
      {spec.kind === "signature" && spec.signatureKey && (
        <SignatureStamp
          value={signatures[spec.signatureKey] ?? ""}
          certify={spec.certify ?? ""}
          disabled={readOnly || !onSign}
          variant="sheet"
          requirement={
            multi && spec.signatureKey
              ? {
                  value: choiceOf({ signatureRequired }, spec.signatureKey),
                  disabled: readOnly || !onSignatureRequired,
                  onChange: (next) => onSignatureRequired?.(spec.signatureKey!, next),
                }
              : undefined
          }
          onSign={async (pin) => {
            if (onSign && spec.signatureKey) await onSign(spec.signatureKey, pin);
          }}
        />
      )}
      {(spec.kind === "label" || spec.kind === "calc") && text}
    </td>
  );
}
