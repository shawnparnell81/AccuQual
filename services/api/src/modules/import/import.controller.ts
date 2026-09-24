import type { NextFunction, Request, Response } from "express";
import ExcelJS from "exceljs";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { logger } from "../../utils/logger.js";
import { getImportEntity, type AnyImportEntity, type ImportContext } from "./import.entities.js";
import { parseSpreadsheet, type ParsedSheet } from "./import.parser.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { requireRole } from "../../middleware/rbac.js";

const MAX_REPORTED_ERRORS = 200;

/** Suppliers and inventory follow their own module's access rules; creating user accounts is admin-only. */
export function entityGate(req: Request, res: Response, next: NextFunction) {
  switch (req.params.entity) {
    case "suppliers":
      return requireDepartmentAccess("suppliers")(req, res, next);
    case "inventory_items":
      return requireDepartmentAccess("inventory")(req, res, next);
    case "people":
      return requireRole("admin")(req, res, next);
    default:
      return next(AppError.notFound("Import type"));
  }
}

function entityOf(req: Request): AnyImportEntity {
  const entity = getImportEntity(String(req.params.entity));
  if (!entity) throw AppError.notFound("Import type");
  return entity;
}

const normalizeHeader = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Best column for each field: an exact match on the field's name or alias first, then a loose "contains" match. A column is never used twice. */
function suggestMapping(entity: AnyImportEntity, headers: string[]): Record<string, number | null> {
  const normalized = headers.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: Record<string, number | null> = {};
  const candidates = (field: AnyImportEntity["fields"][number]) => [field.key, field.label, ...(field.aliases ?? [])].map(normalizeHeader).filter(Boolean);

  for (const pass of ["exact", "loose"] as const) {
    for (const field of entity.fields) {
      if (mapping[field.key] != null) continue;
      const names = candidates(field);
      const index = normalized.findIndex((header, i) => !used.has(i) && header !== "" && names.some((name) => (pass === "exact" ? header === name : header.includes(name) || (name.length >= 4 && name.includes(header) && header.length >= 3))));
      if (index >= 0) {
        mapping[field.key] = index;
        used.add(index);
      }
    }
  }
  for (const field of entity.fields) mapping[field.key] ??= null;
  return mapping;
}

async function readUpload(req: Request): Promise<ParsedSheet> {
  if (!req.file) throw AppError.badRequest("Choose an Excel (.xlsx) or CSV file to import.");
  return parseSpreadsheet(req.file.buffer, req.file.originalname);
}

export const describeHandler = asyncHandler(async (req: Request, res: Response) => {
  const entity = entityOf(req);
  res.json({ key: entity.key, label: entity.label, description: entity.description, fields: entity.fields });
});

export const templateHandler = asyncHandler(async (req: Request, res: Response) => {
  const entity = entityOf(req);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Import");
  sheet.addRow(entity.fields.map((f) => f.label));
  sheet.addRow(entity.fields.map((f) => f.example ?? ""));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(2).font = { italic: true, color: { argb: "FF888888" } };
  entity.fields.forEach((_, i) => (sheet.getColumn(i + 1).width = 26));
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const notes = workbook.addWorksheet("Notes");
  notes.addRow(["Column", "Required?", "Notes"]).font = { bold: true };
  for (const f of entity.fields) notes.addRow([f.label, f.required ? "Yes" : "No", f.help ?? ""]);
  notes.addRow([]);
  notes.addRow(["Delete the grey example row before importing. Only the first sheet is read."]);
  notes.getColumn(1).width = 28;
  notes.getColumn(3).width = 80;

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${entity.key}-import-template.xlsx"`);
  res.send(buffer);
});

export const previewHandler = asyncHandler(async (req: Request, res: Response) => {
  const entity = entityOf(req);
  const sheet = await readUpload(req);
  res.json({
    headers: sheet.headers,
    sample: sheet.rows.slice(0, 5).map((row) => row.cells),
    totalRows: sheet.rows.length,
    mapping: suggestMapping(entity, sheet.headers),
  });
});

interface RowProblem {
  row: number;
  /** The row's main value (name / SKU / email), so the list is readable without the spreadsheet open. */
  label: string;
  messages: string[];
}

export const runHandler = asyncHandler(async (req: Request, res: Response) => {
  const entity = entityOf(req);
  const sheet = await readUpload(req);

  let mapping: Record<string, number | null>;
  try {
    mapping = JSON.parse(String(req.body.mapping ?? "{}"));
  } catch {
    throw AppError.badRequest("The column mapping wasn't understood. Go back and map the columns again.");
  }
  for (const field of entity.fields) {
    const column = mapping[field.key];
    if (field.required && (column === null || column === undefined)) throw AppError.badRequest(`Pick which column holds "${field.label}".`);
    if (column !== null && column !== undefined && (!Number.isInteger(column) || column < 0 || column >= sheet.headers.length)) throw AppError.badRequest(`The column chosen for "${field.label}" isn't in the file.`);
  }
  const importing = req.body.mode === "import";

  const raws = sheet.rows.map((row) => {
    const raw: Record<string, string> = {};
    for (const field of entity.fields) {
      const column = mapping[field.key];
      raw[field.key] = column === null || column === undefined ? "" : (row.cells[column] ?? "");
    }
    return { number: row.number, raw };
  });

  const ctx: ImportContext = { db: req.db!, tenantId: req.tenantId!, userId: req.user?.id };
  const primary = entity.fields[0]!.key;
  const lookups = await entity.prepare(ctx, raws.map((r) => (r.raw[primary] ?? "").trim().toLowerCase()).filter(Boolean));

  const problems: RowProblem[] = [];
  const valid: { number: number; label: string; value: unknown }[] = [];
  const seen = new Map<string, number>();
  for (const { number, raw } of raws) {
    const result = entity.validate(raw, lookups);
    const messages = [...result.errors];
    const label = (raw[primary] ?? "").trim() || "(blank)";
    if (result.identity) {
      if (lookups.existing.has(result.identity)) messages.push(`${label} already exists.`);
      else if (seen.has(result.identity)) messages.push(`${label} appears more than once in the file (first on row ${seen.get(result.identity)}).`);
      else seen.set(result.identity, number);
    }
    if (messages.length > 0) problems.push({ row: number, label, messages });
    else valid.push({ number, label, value: result.value });
  }

  const created: { row: number; id: number; label: string; temporaryPassword?: string }[] = [];
  if (importing) {
    for (const item of valid) {
      try {
        // A savepoint per row: one row the database rejects can't undo the rows that already went in.
        const made = await ctx.db.transaction(async (tx) => entity.insert({ ...ctx, db: tx as unknown as ImportContext["db"] }, item.value, lookups));
        created.push({ row: item.number, ...made });
      } catch (err) {
        logger.error("Import row failed to save", { entity: entity.key, row: item.number, err });
        problems.push({ row: item.number, label: item.label, messages: ["Couldn't be saved. Check the values and try this row again."] });
      }
    }
  }

  const sortedProblems = problems.sort((a, b) => a.row - b.row);
  res.json({
    entity: entity.key,
    mode: importing ? "import" : "validate",
    total: raws.length,
    valid: valid.length,
    invalid: sortedProblems.length,
    created: created.length,
    problems: sortedProblems.slice(0, MAX_REPORTED_ERRORS),
    problemsTruncated: sortedProblems.length > MAX_REPORTED_ERRORS,
    createdRows: importing ? created.map(({ temporaryPassword: _pw, ...rest }) => rest).slice(0, 500) : [],
    credentials: importing && entity.key === "people" ? created.filter((c) => c.temporaryPassword).map((c) => ({ row: c.row, email: c.label, temporaryPassword: c.temporaryPassword })) : [],
  });
});
