import { useEffect, useState, type CSSProperties } from "react";
import { columnLetter, type CellStyle, type GridCell, type SheetGrid } from "../../lib/spreadsheetFormat";
import type { SpreadsheetBook } from "../../lib/spreadsheetPreview";
import "./officePreview.css";

function cellCss(style: CellStyle): CSSProperties {
  return {
    fontWeight: style.bold ? 700 : undefined,
    fontStyle: style.italic ? "italic" : undefined,
    textDecoration: [style.underline ? "underline" : "", style.strike ? "line-through" : ""].filter(Boolean).join(" ") || undefined,
    fontFamily: style.fontFamily,
    fontSize: style.fontSizePt ? `${style.fontSizePt}pt` : undefined,
    color: style.color,
    background: style.background,
    textAlign: style.align,
    verticalAlign: style.valign,
    whiteSpace: style.wrap ? "pre-wrap" : "nowrap",
    borderTop: style.borderTop,
    borderRight: style.borderRight,
    borderBottom: style.borderBottom,
    borderLeft: style.borderLeft,
  };
}

function SheetTable({ sheet }: { sheet: SheetGrid }) {
  const cols = sheet.rows[0]?.length ?? 0;
  if (sheet.rows.length === 0 || cols === 0) {
    return <p className="text-sm text-muted-foreground">This sheet is empty.</p>;
  }
  return (
    <div className="sheet-scroll aq-paper">
      <table className="sheet-grid">
        <colgroup>
          <col style={{ width: 42 }} />
          {sheet.colWidths.map((width, index) => (
            <col key={index} style={{ width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="sheet-corner" />
            {Array.from({ length: cols }, (_, index) => (
              <th key={index}>{columnLetter(index + 1)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sheet.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              <td className="sheet-rowhead">{rowIndex + 1}</td>
              {row.map((cell, cellIndex) => (cell ? <BodyCell key={cellIndex} cell={cell} /> : null))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BodyCell({ cell }: { cell: GridCell }) {
  return (
    <td rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined} colSpan={cell.colSpan > 1 ? cell.colSpan : undefined} style={cellCss(cell.style)} title={cell.text || undefined}>
      {cell.text}
    </td>
  );
}

/**
 * Read-only grid for .xlsx, .xls, and .csv. ExcelJS (and the legacy .xls reader)
 * load only when this pane opens.
 */
export function SpreadsheetPreviewPane({ data, fileName }: { data: ArrayBuffer; fileName: string }) {
  const [book, setBook] = useState<SpreadsheetBook | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBook(null);
    setError(null);
    setSheetIndex(0);
    void import("../../lib/spreadsheetPreview")
      .then((mod) => mod.loadSpreadsheet(data, fileName))
      .then((next) => {
        if (!cancelled) setBook(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error && err.message ? err.message : "Couldn't read that spreadsheet.");
      });
    return () => {
      cancelled = true;
    };
  }, [data, fileName]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!book) return <p className="text-sm text-muted-foreground">Opening preview…</p>;

  const sheet = book.sheets[Math.min(sheetIndex, book.sheets.length - 1)]!;
  const truncated = sheet.truncatedRows || sheet.truncatedCols;

  return (
    <div className="flex flex-col gap-2">
      {book.sheets.length > 1 && (
        <div className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-border bg-background" role="tablist" aria-label="Sheets">
          {book.sheets.map((item, index) => (
            <button
              key={`${item.name}-${index}`}
              type="button"
              role="tab"
              aria-selected={index === sheetIndex}
              onClick={() => setSheetIndex(index)}
              className={`shrink-0 rounded-t-md border border-b-0 px-3 py-1.5 text-sm ${
                index === sheetIndex ? "border-primary bg-card font-medium text-foreground" : "border-transparent text-muted-foreground hover:bg-muted"
              }`}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}
      {truncated && (
        <p className="text-xs text-muted-foreground">
          Showing the first {sheet.truncatedRows ? `${sheet.rows.length} of ${sheet.rowCount} rows` : "rows"}
          {sheet.truncatedCols ? ` and the first ${sheet.rows[0]?.length ?? 0} of ${sheet.colCount} columns` : ""}. Download the file to see the rest.
        </p>
      )}
      <SheetTable sheet={sheet} />
    </div>
  );
}
