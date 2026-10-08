import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { isListKey, type CellPatch } from "./logic.js";
import { changeControlledListColumns, changeControlledListRows, downloadControlledList, insertControlledListLocation, openControlledList, saveControlledList } from "./service.js";

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
  const body = req.body as { sheet?: string; op?: string; row?: number; rows?: number[]; place?: string };
  if (body.op !== "add" && body.op !== "delete" && body.op !== "insert") throw AppError.badRequest("Choose add, insert, or delete.");
  if (!body.sheet) throw AppError.badRequest("Choose a sheet.");
  const place = body.place === "below" ? "below" : body.place === "above" ? "above" : undefined;
  const rows = Array.isArray(body.rows) ? body.rows.filter((row) => typeof row === "number") : undefined;
  res.json(await changeControlledListRows(req, keyFrom(req), body.sheet, body.op, body.row, rows, place));
});

export const columnsControlledListHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { sheet?: string; op?: string; col?: string; name?: string };
  if (body.op !== "add" && body.op !== "rename" && body.op !== "remove") throw AppError.badRequest("Choose add, rename, or remove.");
  if (!body.sheet) throw AppError.badRequest("Choose a sheet.");
  res.json(await changeControlledListColumns(req, keyFrom(req), body.sheet, body.op, body.col, body.name));
});

export const locationControlledListHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { sheet?: string; path?: string };
  if (!body.sheet) throw AppError.badRequest("Choose a sheet.");
  if (typeof body.path !== "string") throw AppError.badRequest("The folder path is empty.");
  res.json(await insertControlledListLocation(req, keyFrom(req), body.sheet, body.path));
});

export const downloadControlledListHandler = asyncHandler(async (req: Request, res: Response) => {
  const file = await downloadControlledList(req, keyFrom(req));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${file.filename.replace(/"/g, "")}"`);
  res.send(file.body);
});
