/**
 * Test helper: reads a validation form's Excel workbook the way Excel left it, so a test can fill the sheet with the
 * workbook's own sample values and compare every formula the app computes with the result Excel stored.
 * Node only (tests); the app itself never reads a workbook.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ExcelJS from "exceljs";
import { addr as makeAddr, XlError, type Value } from "./engine";
import type { Cells } from "./formModule";

const here = dirname(fileURLToPath(import.meta.url));
export const WORKBOOK_DIR = join(here, "..", "..", "..", "..", "..", "docs", "validation-forms");

export interface WorkbookSample {
  /** Every constant (non-formula) cell the workbook holds, by address. */
  constants: Cells;
  /** What Excel stored as each formula cell's result. */
  cached: Record<string, Value>;
}

export async function readWorkbookSample(file: string, sheet = 1): Promise<WorkbookSample> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(join(WORKBOOK_DIR, file));
  const ws = workbook.getWorksheet(sheet) ?? workbook.worksheets[0]!;
  const constants: Cells = {};
  const cached: Record<string, Value> = {};
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (cell.isMerged && cell.master.address !== cell.address) return;
      const at = makeAddr(colNumber, rowNumber);
      const raw = cell.value as unknown;
      if (raw != null && typeof raw === "object" && !(raw instanceof Date) && ("formula" in raw || "sharedFormula" in raw)) {
        const result = (raw as { result?: unknown }).result;
        // A workbook saved without calculating (by a script, say) has no stored result; there is nothing to compare then.
        if (result === undefined || result === null) return;
        cached[at] = typeof result === "object" && "error" in (result as object) ? new XlError(String((result as { error: string }).error)) : (result as Value);
      } else if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
        constants[at] = raw;
      }
    });
  });
  return { constants, cached };
}

/** True when two cell values are the same to the precision Excel shows (1e-9), with TRUE/FALSE and text compared exactly. */
export function sameValue(a: Value | undefined, b: Value | undefined): boolean {
  const left = a ?? null;
  const right = b ?? null;
  if (left == null || left === "") return right == null || right === "";
  if (right == null || right === "") return false;
  if (left instanceof XlError || right instanceof XlError) return left instanceof XlError && right instanceof XlError && left.code === right.code;
  if (typeof left === "number" && typeof right === "number") return Math.abs(left - right) < 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));
  return left === right;
}
