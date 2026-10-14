import { useMemo, type CSSProperties, type ReactNode } from "react";
import { SignatureStamp } from "../../components/forms/SignatureStamp";
import { parseRange, columnLetters, parseAddr, type Value } from "../../lib/validation-forms/engine";
import type { CellValue, Cells, FormModule } from "../../lib/validation-forms/formModule";
import type { BorderStyle, LayoutStyle } from "../../lib/validation-forms/layoutTypes";

export interface RegistrySheetProps {
  module: FormModule;
  cells: Cells;
  readOnly?: boolean;
  onChange: (addr: string, value: CellValue) => void;
  /** The record number, shown after "Doc ID:". */
  documentNumber?: string;
  /** The revision this record was saved under, shown after "Rev:". */
  revision?: string;
  /** Saved authorized signatures by their data path. */
  signatures?: Record<string, string>;
  onSign?: (path: string, pin: string) => Promise<unknown>;
  /** Extra content under the sheet, such as the Graphs tab's chart. */
  children?: ReactNode;
}

const COL_PX = (width: number) => Math.round(width * 7 + 5);
const ROW_PX = (points: number) => Math.round((points * 4) / 3);

const BORDER_CSS: Record<BorderStyle, string> = {
  thin: "1px solid #000",
  medium: "2px solid #000",
  thick: "3px solid #000",
  dashed: "1px dashed #000",
  dotted: "1px dotted #000",
  double: "3px double #000",
  hair: "1px solid #888",
};

function fontStack(name: string | undefined): string {
  if (!name) return 'Arial, "Helvetica Neue", sans-serif';
  if (/aptos narrow|arial narrow/i.test(name)) return '"Aptos Narrow", "Arial Narrow", Arial, sans-serif';
  return `"${name}", Arial, sans-serif`;
}

function placeText(raw: string, module: FormModule, addr: string, documentNumber: string, revision: string): string {
  const { def } = module;
  if (addr === def.docIdCell) return documentNumber.trim() ? `Doc ID: ${documentNumber.trim()}` : raw;
  if (addr === def.revCell) return `Rev: ${revision || def.revision}`;
  return raw;
}

interface Placed {
  addr: string;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

/**
 * Draws a validation form from its workbook layout: the same cells, merges, column widths, fonts, fills and borders. Cells a
 * person fills in are inputs, formula cells show what the workbook's formulas give, and the workbook's conditional formats
 * (Pass green, Fail red, blank yellow) apply as they do in Excel.
 */
export function RegistrySheet({ module, cells, readOnly = false, onChange, documentNumber = "", revision = "", signatures = {}, onSign, children }: RegistrySheetProps) {
  const { def } = module;
  const { layout } = def;
  const values = useMemo(() => module.evaluate(cells), [module, cells]);

  const placed = useMemo(() => {
    const spans = new Map<string, { rowSpan: number; colSpan: number }>();
    const covered = new Set<string>();
    for (const merge of layout.merges) {
      const range = parseRange(merge);
      if (!range) continue;
      spans.set(`${columnLetters(range.c1)}${range.r1}`, { rowSpan: range.r2 - range.r1 + 1, colSpan: range.c2 - range.c1 + 1 });
      for (let row = range.r1; row <= range.r2; row += 1) {
        for (let col = range.c1; col <= range.c2; col += 1) if (row !== range.r1 || col !== range.c1) covered.add(`${columnLetters(col)}${row}`);
      }
    }
    const out: Placed[] = [];
    for (const addr of Object.keys(layout.cells)) {
      if (covered.has(addr)) continue;
      const pos = parseAddr(addr);
      if (!pos) continue;
      const span = spans.get(addr);
      out.push({ addr, row: pos.row, col: pos.col, rowSpan: span?.rowSpan ?? 1, colSpan: span?.colSpan ?? 1 });
    }
    return out;
  }, [layout]);

  const styleAt = (col: number, row: number): LayoutStyle | undefined => layout.styles[layout.cells[`${columnLetters(col)}${row}`]?.s ?? 0];

  /** Borders are drawn once per edge: a cell draws its right and bottom edge (its own, or the neighbor's left/top). */
  function edges(cell: Placed): CSSProperties {
    const own = styleAt(cell.col, cell.row);
    const lastCol = cell.col + cell.colSpan - 1;
    const lastRow = cell.row + cell.rowSpan - 1;
    const right = styleAt(lastCol, cell.row)?.border?.r ?? styleAt(lastCol + 1, cell.row)?.border?.l;
    const bottom = styleAt(cell.col, lastRow)?.border?.b ?? styleAt(cell.col, lastRow + 1)?.border?.t;
    const css: CSSProperties = {};
    if (right) css.borderRight = BORDER_CSS[right];
    if (bottom) css.borderBottom = BORDER_CSS[bottom];
    if (cell.col === 1 && own?.border?.l) css.borderLeft = BORDER_CSS[own.border.l];
    if (cell.row === 1 && own?.border?.t) css.borderTop = BORDER_CSS[own.border.t];
    return css;
  }

  const gridCols = layout.cols.map((w) => `${COL_PX(w)}px`).join(" ");
  // Rows with a PIN signature grow to fit the stamped name and date/time; every other row keeps the workbook's height.
  const signatureRows = new Set((def.signatures ?? []).map((slot) => parseAddr(slot.addr)?.row).filter((row): row is number => row != null));
  const gridRows = Array.from({ length: layout.maxRow }, (_, index) => {
    const px = `${ROW_PX(layout.rowHeights[String(index + 1)] ?? layout.defaultRowHeight)}px`;
    return signatureRows.has(index + 1) ? `minmax(${px}, auto)` : px;
  }).join(" ");
  const totalWidth = layout.cols.reduce((sum, w) => sum + COL_PX(w), 0);
  /** Pixels from the left edge to a zero-based column position such as 3.4 (3.4 is 40% of the way into column D). */
  const colLeft = (col: number) => {
    const whole = Math.floor(col);
    const before = layout.cols.slice(0, whole).reduce((sum, w) => sum + COL_PX(w), 0);
    return before + (col - whole) * COL_PX(layout.cols[whole] ?? 8.43);
  };
  const rowTop = (row: number) => {
    const whole = Math.floor(row);
    let top = 0;
    for (let r = 1; r <= whole; r += 1) top += ROW_PX(layout.rowHeights[String(r)] ?? layout.defaultRowHeight);
    return top + (row - whole) * ROW_PX(layout.rowHeights[String(whole + 1)] ?? layout.defaultRowHeight);
  };

  return (
    <div className="vf-wrap" data-testid={`${def.type}-sheet`}>
      <div className="vf-sheet" role="table" aria-label={def.title} style={{ gridTemplateColumns: gridCols, gridTemplateRows: gridRows, width: totalWidth }}>
        {placed.map((cell) => {
          const kind = module.kinds[cell.addr] ?? "spacer";
          const layoutCell = layout.cells[cell.addr]!;
          const style = layout.styles[layoutCell.s] ?? {};
          const dynamic = module.conditionalStyle(cell.addr, values, cells);
          const css: CSSProperties = {
            gridColumn: `${cell.col} / span ${cell.colSpan}`,
            gridRow: `${cell.row} / span ${cell.rowSpan}`,
            fontFamily: fontStack(style.font),
            fontSize: style.sz ? `${style.sz}pt` : "11pt",
            fontWeight: dynamic?.b || style.b ? 700 : 400,
            fontStyle: style.i ? "italic" : undefined,
            textDecoration: style.u ? "underline" : undefined,
            color: dynamic?.fg ?? style.fg ?? "#000",
            background: dynamic?.bg ?? style.bg ?? "#fff",
            textAlign: style.h ?? (kind === "calc" ? undefined : undefined),
            justifyContent: style.h === "center" ? "center" : style.h === "right" ? "flex-end" : "flex-start",
            alignItems: style.v === "top" ? "flex-start" : style.v === "middle" ? "center" : "flex-end",
            whiteSpace: style.wrap ? "pre-wrap" : "nowrap",
            paddingLeft: style.indent ? `${3 + style.indent * 8}px` : undefined,
            ...edges(cell),
          };
          return (
            <div key={cell.addr} className={`vf-cell vf-${kind}`} style={css} role="cell" data-addr={cell.addr} title={kind === "calc" ? `=${module.formulas[cell.addr] ?? ""}` : undefined}>
              <CellBody
                module={module}
                addr={cell.addr}
                kind={kind}
                raw={layoutCell.v}
                value={values[cell.addr]}
                cells={cells}
                readOnly={readOnly}
                onChange={onChange}
                documentNumber={documentNumber}
                revision={revision}
                signatures={signatures}
                onSign={onSign}
                style={style}
              />
            </div>
          );
        })}
        {layout.images.map((image, index) => (
          <img
            key={index}
            alt=""
            src={image.src}
            className="vf-image"
            style={{ left: colLeft(image.from.col), top: rowTop(image.from.row), width: colLeft(image.to.col) - colLeft(image.from.col), height: rowTop(image.to.row) - rowTop(image.from.row) }}
          />
        ))}
      </div>
      {children}
    </div>
  );
}

function CellBody({
  module,
  addr,
  kind,
  raw,
  value,
  cells,
  readOnly,
  onChange,
  documentNumber,
  revision,
  signatures,
  onSign,
  style,
}: {
  module: FormModule;
  addr: string;
  kind: string;
  raw: string | number | boolean | undefined;
  value: Value | undefined;
  cells: Cells;
  readOnly: boolean;
  onChange: (addr: string, value: CellValue) => void;
  documentNumber: string;
  revision: string;
  signatures: Record<string, string>;
  onSign?: (path: string, pin: string) => Promise<unknown>;
  style: LayoutStyle;
}) {
  const { def } = module;
  const typed = cells[addr];
  const inputValue = typed === undefined || typeof typed === "boolean" ? (typeof raw === "string" || typeof raw === "number" ? "" : "") : String(typed);
  const edit = (next: string) => onChange(addr, next);
  const inheritFont: CSSProperties = { font: "inherit", textAlign: style.h ?? "left", color: "inherit" };

  if (kind === "calc") {
    // A formula that gives TRUE or FALSE is a tick box the form ticks for you.
    if (typeof value === "boolean") return <input type="checkbox" className="vf-check" aria-label={addr} checked={value} readOnly disabled />;
    const shown = module.display(addr, value);
    return <span data-result={def.resultCells.includes(addr) ? shown : undefined}>{shown}</span>;
  }
  if (kind === "label") {
    const text = typeof raw === "number" ? module.display(addr, raw) : String(raw ?? "");
    return <span>{placeText(text, module, addr, documentNumber, revision)}</span>;
  }
  if (kind === "input") {
    return <input className="vf-in" style={inheritFont} aria-label={addr} value={inputValue} disabled={readOnly} onChange={(event) => edit(event.target.value)} />;
  }
  if (kind === "area") {
    return <textarea className="vf-in" style={inheritFont} aria-label={addr} value={inputValue} disabled={readOnly} onChange={(event) => edit(event.target.value)} />;
  }
  if (kind === "select") {
    const options = module.lists[addr] ?? [];
    return (
      <select className="vf-in" style={inheritFont} aria-label={addr} value={inputValue} disabled={readOnly} onChange={(event) => edit(event.target.value)}>
        <option value="" />
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        {inputValue && !options.includes(inputValue) && <option value={inputValue}>{inputValue}</option>}
      </select>
    );
  }
  if (kind === "tick") {
    // "[ ] APPROVED WITH DEVIATION": clicking flips the box in the text. The tick is saved as true or false.
    const on = typed === true;
    const label = String(raw ?? "").replace(/^\[\s*[xX]?\s*\]/, on ? "[X]" : "[ ]");
    return (
      <button type="button" className="vf-tick" aria-pressed={on} aria-label={addr} disabled={readOnly} onClick={() => onChange(addr, !on)}>
        {label}
      </button>
    );
  }
  if (kind === "check") {
    return <input type="checkbox" className="vf-check" aria-label={addr} checked={typed === true} disabled={readOnly} onChange={(event) => onChange(addr, event.target.checked)} />;
  }
  if (kind === "signature") {
    const slot = def.signatures?.find((item) => item.addr === addr);
    if (!slot) return null;
    return (
      <SignatureStamp
        value={signatures[slot.path] ?? ""}
        certify={slot.certify}
        disabled={readOnly || !onSign}
        variant="sheet"
        onSign={async (pin) => {
          if (onSign) await onSign(slot.path, pin);
        }}
      />
    );
  }
  return null;
}
