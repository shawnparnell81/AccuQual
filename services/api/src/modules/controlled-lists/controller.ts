import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { isListKey, type CellPatch } from "./logic.js";
import { changeControlledListRows, downloadControlledList, openControlledList, saveControlledList } from "./service.js";

function keyFrom(req: Request) {
  const key = String(req.params.key ?? "");
  if (!isListKey(key)) throw AppError.notFound("Controlled list");
  return key;
}

export const getControlledListHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await openControlledList(req, keyFrom(req)));
});

export const saveControlledListHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { sheets?: Array<{ name?: string; cells?: Record<string, CellPatch> }> };
  const sheets = Array.isArray(body.sheets) ? body.sheets : [];
  const patches = sheets
    .filter((sheet) => typeof sheet.name === "string" && sheet.cells && typeof sheet.cells === "object")
    .map((sheet) => ({ name: sheet.name as string, cells: sheet.cells as Record<string, CellPatch> }));
  res.json(await saveControlledList(req, keyFrom(req), patches));
});

export const rowsControlledListHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { sheet?: string; op?: string; row?: number };
  if (body.op !== "add" && body.op !== "delete") throw AppError.badRequest("Choose add or delete.");
  if (!body.sheet) throw AppError.badRequest("Choose a sheet.");
  res.json(await changeControlledListRows(req, keyFrom(req), body.sheet, body.op, body.row));
});

export const downloadControlledListHandler = asyncHandler(async (req: Request, res: Response) => {
  const file = await downloadControlledList(req, keyFrom(req));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${file.filename.replace(/"/g, "")}"`);
  res.send(file.body);
});
