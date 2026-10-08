import { columnLetter } from "./spreadsheetFormat";
import { displayFormulaValue, evaluateCells, passFailFill, type FormulaValue } from "./excelFormulas";
import { loadEditableSpreadsheet, type EditableImportSheet } from "./spreadsheetPreview";

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

export interface DocumentFormStructure {
  kind: "document";
  html: string;
  showLogo: boolean;
  showPageNumbers: boolean;
}

export type FieldType = "text" | "multiline" | "number" | "date" | "dropdown" | "checkbox" | "yesno" | "table" | "signature" | "photo";

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
  return { kind: "document", html: "<h1></h1><p></p>", showLogo: true, showPageNumbers: true };
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

export function shownCell(cell: FormCell, calculated: Record<string, FormulaValue>, col: number, row: number, answer?: string): string {
  if (cell.formula) return displayFormulaValue(calculated[addressOf(col, row)]);
  if (!cell.locked && answer != null) return answer;
  return cell.value;
}

export function cellPaint(cell: FormCell, text: string): { background?: string; color?: string } {
  if (cell.conditional || cell.formula) {
    const fill = passFailFill(text);
    if (fill) return fill;
  }
  return { background: cell.style.background, color: cell.style.color };
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
export async function downloadGridWorkbook(structure: GridFormStructure, filename: string): Promise<void> {
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
        if (cell.formula) target.value = { formula: cell.formula.replace(/^=/, "") };
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
