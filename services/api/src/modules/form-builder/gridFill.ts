/**
 * Saving a filled grid copy. The server works out every formula cell from the copy's own layout and the typed
 * answers, with the same engine the screen uses. Whatever the browser sent for a formula, label, folder path or
 * signature cell is not kept as a typed answer.
 */
import { cellAddress, displayValue, evaluateGrid, type CellInputs } from "./formulaEngine.js";

interface GridCell {
  value?: unknown;
  formula?: unknown;
  locked?: unknown;
  type?: unknown;
  folderPath?: unknown;
  decimals?: unknown;
}

interface GridSheet {
  cells?: unknown;
  colWidths?: unknown;
}

function sheetsOf(structure: unknown): GridSheet[] | null {
  if (!structure || typeof structure !== "object") return null;
  const record = structure as { kind?: unknown; sheets?: unknown };
  if (record.kind !== "grid" || !Array.isArray(record.sheets)) return null;
  return record.sheets as GridSheet[];
}

function rowsOf(sheet: GridSheet): Array<Array<GridCell | null>> {
  return Array.isArray(sheet.cells) ? (sheet.cells as Array<Array<GridCell | null>>) : [];
}

function formulaOf(cell: GridCell): string | null {
  return typeof cell.formula === "string" && cell.formula.trim() !== "" ? cell.formula.replace(/^=/, "") : null;
}

/** A cell the person filling the copy types into. */
export function isInputCell(cell: GridCell): boolean {
  return cell.locked !== true && !formulaOf(cell) && cell.folderPath !== true && cell.type !== "signature";
}

export interface GridCellKind {
  key: string;
  kind: "input" | "formula" | "signature" | "fixed";
}

/** Every anchor cell of the copy with its answer key (sheet!A1) and what it holds. */
export function gridCellKinds(structure: unknown): GridCellKind[] {
  const sheets = sheetsOf(structure);
  if (!sheets) return [];
  const out: GridCellKind[] = [];
  sheets.forEach((sheet, sheetIndex) => {
    rowsOf(sheet).forEach((row, rowIndex) => {
      (Array.isArray(row) ? row : []).forEach((cell, colIndex) => {
        if (!cell || typeof cell !== "object") return;
        const key = `${sheetIndex}!${cellAddress(colIndex + 1, rowIndex + 1)}`;
        const kind = formulaOf(cell) ? "formula" : cell.type === "signature" ? "signature" : isInputCell(cell) ? "input" : "fixed";
        out.push({ key, kind });
      });
    });
  });
  return out;
}

/**
 * The answers to store for a grid copy: typed answers for input cells, signature stamps as they are, and the
 * calculated text for every formula cell. Answers for other keys (fields outside the grid) pass through.
 * Returns null when the structure is not a grid.
 */
export function recomputeGridAnswers(structure: unknown, answers: Record<string, unknown>): Record<string, unknown> | null {
  const sheets = sheetsOf(structure);
  if (!sheets) return null;
  const kinds = new Map(gridCellKinds(structure).map((item) => [item.key, item.kind]));
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(answers)) {
    const kind = kinds.get(key);
    if (kind === undefined) {
      // Only grid addresses are tied to the layout; anything else (none today) is kept.
      if (!/^\d+!/.test(key)) next[key] = value;
      continue;
    }
    if (kind === "input" && typeof value === "string") next[key] = value;
    if (kind === "signature" && value && typeof value === "object") next[key] = value;
  }
  sheets.forEach((sheet, sheetIndex) => {
    const rows = rowsOf(sheet);
    const inputs: CellInputs = {};
    const formulaCells: Array<{ local: string; decimals?: number }> = [];
    rows.forEach((row, rowIndex) => {
      (Array.isArray(row) ? row : []).forEach((cell, colIndex) => {
        if (!cell || typeof cell !== "object") return;
        const local = cellAddress(colIndex + 1, rowIndex + 1);
        const formula = formulaOf(cell);
        const answer = next[`${sheetIndex}!${local}`];
        if (formula) {
          inputs[local] = `=${formula}`;
          formulaCells.push({ local, decimals: typeof cell.decimals === "number" ? cell.decimals : undefined });
        } else if (isInputCell(cell) && typeof answer === "string") inputs[local] = answer;
        else inputs[local] = typeof cell.value === "string" ? cell.value : "";
      });
    });
    if (formulaCells.length === 0) return;
    const cols = Array.isArray(sheet.colWidths) ? sheet.colWidths.length : undefined;
    const values = evaluateGrid(inputs, { rows: rows.length, cols });
    for (const { local, decimals } of formulaCells) next[`${sheetIndex}!${local}`] = displayValue(values[local], decimals);
  });
  return next;
}
