import { columnLetter } from "./spreadsheetFormat";
import { displayFormulaValue, evaluateCells, passFailFill, type FormulaValue } from "./excelFormulas";
import { loadEditableSpreadsheet, type EditableImportSheet } from "./spreadsheetPreview";
import type { DocumentBand } from "./documentBands";

/** Near-black, matching the validation grids' ink on a light status fill. */
const INK_DARK = "#111111";
/** White ink for a dark fill such as the DMA Blue header. */
const INK_LIGHT = "#ffffff";

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function hexLuminance(hex: string): number | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match?.[1]) return null;
  const n = Number.parseInt(match[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

function contrastRatio(a: number, b: number): number {
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Whichever of near-black or white actually contrasts with a fill.
 * The validation sheets use #111 on a light Pass/Fail fill. A dark fill
 * such as DMA Blue needs white, or the label disappears.
 */
export function inkOnFill(background: string): string | undefined {
  const lum = hexLuminance(background);
  const dark = hexLuminance(INK_DARK);
  if (lum == null || dark == null) return undefined;
  const onLight = contrastRatio(lum, 1);
  const onDark = contrastRatio(lum, dark);
  return onLight >= onDark ? INK_LIGHT : INK_DARK;
}

export interface FormCellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontFamily?: string;
  fontSizePt?: number;
  color?: string;
  background?: string;
  align?: "left" | "center" | "right" | "justify";
  valign?: "top" | "middle" | "bottom";
  wrap?: boolean;
  borderTop?: string;
  borderRight?: string;
  borderBottom?: string;
  borderLeft?: string;
}

export interface FormCell {
  value: string;
  formula?: string;
  locked: boolean;
  rowSpan: number;
  colSpan: number;
  /** Paint Passed green and Failed red, the same colors as the validation sheets. */
  conditional?: boolean;
  /** Shows the form's current folder path. The text is not stored, so a move updates it. */
  folderPath?: boolean;
  style: FormCellStyle;
}

export interface FormSheet {
  name: string;
  colWidths: number[];
  rowHeights: number[];
  cells: Array<Array<FormCell | null>>;
}

export interface GridFormStructure {
  kind: "grid";
  sheets: FormSheet[];
}

export interface DocumentChromeField {
  id: string;
  place: "header" | "footer";
  kind: "folderPath";
  label: string;
}

export interface DocumentFormStructure {
  kind: "document";
  html: string;
  showLogo: boolean;
  showPageNumbers: boolean;
  header?: DocumentBand | null;
  footer?: DocumentBand | null;
  chrome?: DocumentChromeField[];
}

export type FieldType = "text" | "multiline" | "number" | "date" | "dropdown" | "checkbox" | "yesno" | "table" | "signature" | "photo" | "folderPath";

export interface FormField {
  id: string;
  sectionId: string;
  type: FieldType;
  label: string;
  required: boolean;
  options?: string[];
  columns?: { id: string; label: string }[];
}

export interface FieldFormStructure {
  kind: "fields";
  sections: { id: string; title: string }[];
  fields: FormField[];
}

export type BuiltStructure = GridFormStructure | DocumentFormStructure | FieldFormStructure;

export function blankCell(): FormCell {
  return { value: "", locked: false, rowSpan: 1, colSpan: 1, style: {} };
}

export function blankGrid(): GridFormStructure {
  return {
    kind: "grid",
    sheets: [
      {
        name: "Sheet1",
        colWidths: Array.from({ length: 8 }, () => 110),
        rowHeights: Array.from({ length: 16 }, () => 24),
        cells: Array.from({ length: 16 }, () => Array.from({ length: 8 }, () => blankCell())),
      },
    ],
  };
}

export function blankDocument(): DocumentFormStructure {
  return { kind: "document", html: "<h1></h1><p></p>", showLogo: true, showPageNumbers: true, header: null, footer: null };
}

export function blankFields(): FieldFormStructure {
  return { kind: "fields", sections: [{ id: "general", title: "General" }], fields: [] };
}

export function addressOf(col: number, row: number): string {
  return `${columnLetter(col)}${row}`;
}

/** Formulas see typed answers on unlocked cells. The template's own text stays put. */
export function formulaInputs(sheet: FormSheet, answers: Record<string, string> | undefined, sheetKey: string): Record<string, string> {
  const cells: Record<string, string> = {};
  sheet.cells.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      if (!cell) return;
      const addr = `${sheetKey}!${addressOf(colIndex + 1, rowIndex + 1)}`;
      const local = addressOf(colIndex + 1, rowIndex + 1);
      const answer = answers?.[addr];
      if (cell.formula) cells[local] = `=${cell.formula.replace(/^=/, "")}`;
      else if (!cell.locked && answer != null) cells[local] = answer;
      else cells[local] = cell.value;
    });
  });
  return cells;
}

export function evaluatedSheet(sheet: FormSheet, answers?: Record<string, string>, sheetKey = "0"): Record<string, FormulaValue> {
  return evaluateCells(formulaInputs(sheet, answers, sheetKey));
}

export function shownCell(cell: FormCell, calculated: Record<string, FormulaValue>, col: number, row: number, answer?: string, folderPath?: string): string {
  if (cell.folderPath) return folderPath ?? "";
  if (cell.formula) return displayFormulaValue(calculated[addressOf(col, row)]);
  if (!cell.locked && answer != null) return answer;
  return cell.value;
}

/**
 * Colors to paint a cell. Stored fills and font colors are not rewritten.
 * A fill with no font color gets an automatic contrasting ink. A cell with
 * neither uses the theme (the caller leaves color and background unset).
 */
export function cellPaint(cell: FormCell, text: string): { background?: string; color?: string } {
  if (cell.conditional || cell.formula) {
    const fill = passFailFill(text);
    if (fill) return { background: fill.background, color: cell.style.color || inkOnFill(fill.background) };
  }
  const background = cell.style.background;
  if (cell.style.color) return { background, color: cell.style.color };
  if (background) return { background, color: inkOnFill(background) };
  return {};
}

/** Display colors for one theme. Default cells use that theme's own ink and paper. */
export function screenCellColors(
  cell: FormCell,
  text: string,
  theme: { background: string; foreground: string },
): { background: string; color: string } {
  const paint = cellPaint(cell, text);
  return {
    background: paint.background ?? theme.background,
    color: paint.color ?? theme.foreground,
  };
}

export function gridFromImport(sheets: EditableImportSheet[]): GridFormStructure {
  return {
    kind: "grid",
    sheets: sheets.map((sheet) => ({
      name: sheet.name || "Sheet",
      colWidths: sheet.colWidths.length ? sheet.colWidths : [110],
      rowHeights: sheet.rowHeights.length ? sheet.rowHeights : [24],
      cells: sheet.rows.map((row) =>
        row.map((cell) => {
          if (!cell) return null;
          const text = cell.text ?? "";
          const formula = cell.formula?.replace(/^=/, "");
          return {
            value: formula ? "" : text,
            formula,
            locked: Boolean(formula) || Boolean(text),
            rowSpan: cell.rowSpan || 1,
            colSpan: cell.colSpan || 1,
            conditional: formula ? /pass|fail/i.test(formula) : false,
            style: cell.style ?? {},
          };
        }),
      ),
    })),
  };
}

export async function importGridFile(file: File): Promise<GridFormStructure> {
  const data = await file.arrayBuffer();
  const sheets = await loadEditableSpreadsheet(data, file.name);
  return gridFromImport(sheets);
}

function borderOf(edge: string | undefined): { style: "thin"; color: { argb: string } } | undefined {
  if (!edge) return undefined;
  const match = /#([0-9a-fA-F]{6})/.exec(edge);
  return { style: "thin", color: { argb: `FF${match?.[1] ?? "000000"}` } };
}

/** Writes the grid with the same formulas, merges, and fills the editor shows. */
export async function downloadGridWorkbook(structure: GridFormStructure, filename: string, folderPath = ""): Promise<void> {
  const ExcelJS = (await import("exceljs")) as typeof import("exceljs") & { default?: typeof import("exceljs") };
  const lib = ExcelJS.default ?? ExcelJS;
  const workbook = new lib.Workbook();
  for (const sheet of structure.sheets) {
    const ws = workbook.addWorksheet(sheet.name || "Sheet");
    sheet.colWidths.forEach((width, index) => {
      ws.getColumn(index + 1).width = Math.max(4, Math.round((width - 5) / 8));
    });
    sheet.cells.forEach((row, rowIndex) => {
      ws.getRow(rowIndex + 1).height = Math.max(12, Math.round((sheet.rowHeights[rowIndex] ?? 24) / 1.33));
      row.forEach((cell, colIndex) => {
        if (!cell) return;
        const target = ws.getCell(rowIndex + 1, colIndex + 1);
        if (cell.folderPath) target.value = folderPath;
        else if (cell.formula) target.value = { formula: cell.formula.replace(/^=/, "") };
        else if (cell.value !== "") {
          const numeric = /^-?\d+(\.\d+)?$/.test(cell.value) ? Number(cell.value) : null;
          target.value = numeric ?? cell.value;
        }
        target.font = {
          bold: cell.style.bold,
          italic: cell.style.italic,
          underline: cell.style.underline,
          name: cell.style.fontFamily,
          size: cell.style.fontSizePt,
          color: cell.style.color ? { argb: `FF${cell.style.color.replace("#", "")}` } : undefined,
        };
        if (cell.style.background) {
          target.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${cell.style.background.replace("#", "")}` } };
        }
        target.alignment = { horizontal: cell.style.align, vertical: cell.style.valign === "middle" ? "middle" : cell.style.valign, wrapText: cell.style.wrap };
        target.border = {
          top: borderOf(cell.style.borderTop),
          right: borderOf(cell.style.borderRight),
          bottom: borderOf(cell.style.borderBottom),
          left: borderOf(cell.style.borderLeft),
        };
        if (cell.rowSpan > 1 || cell.colSpan > 1) {
          ws.mergeCells(rowIndex + 1, colIndex + 1, rowIndex + cell.rowSpan, colIndex + cell.colSpan);
        }
      });
    });
  }
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
