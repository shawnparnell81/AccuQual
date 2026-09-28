import { createReadStream } from "node:fs";
import { mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config/env.js";
import { db } from "../../db/index.js";
import { dataImports } from "../../drizzle/schema/dataImports.js";
import { users } from "../../drizzle/schema/users.js";
import { roles } from "../../drizzle/schema/roles.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { isFullAccessRole, roleHasImportPermission } from "../roles/roleAccess.js";
import { suggestMapping } from "./import.controller.js";
import { IMPORT_CATALOG, getCatalogEntry } from "./import.catalog.js";
import { SYNC_ROW_LIMIT, executeImport, scheduleImport } from "./import.job.js";
import { sniffSpreadsheet } from "../../utils/fileSniff.js";
import { scanSpreadsheet } from "./import.scan.js";

const optionsSchema = z.object({
  mapping: z.record(z.string(), z.number().int().min(0).nullable()),
  badRowMode: z.enum(["skip", "fail"]).default("skip"),
  duplicateMode: z.enum(["skip", "update", "create_only"]).default("skip"),
  sendInvites: z.boolean().optional(),
});

function importsDir() {
  return path.resolve(env.STORAGE_LOCAL_PATH, "imports");
}

function insideStorage(filePath: string): string {
  const root = path.resolve(env.STORAGE_LOCAL_PATH) + path.sep;
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(root)) throw AppError.notFound("File");
  return resolved;
}

export const importUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      mkdir(importsDir(), { recursive: true })
        .then(() => cb(null, importsDir()))
        .catch((err: Error) => cb(err, importsDir()));
    },
    filename: (_req, _file, cb) => {
      cb(null, `${Date.now()}-${randomBytes(8).toString("hex")}`);
    },
  }),
  limits: { fileSize: env.IMPORT_MAX_BYTES, files: 1 },
});

export function uploadImportFile(req: Request, res: Response, next: NextFunction) {
  importUpload.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    const code = (err as { code?: string }).code;
    if (code === "LIMIT_FILE_SIZE") return next(AppError.badRequest(`That file is larger than ${Math.round(env.IMPORT_MAX_BYTES / (1024 * 1024))} MB. Split it into smaller files.`));
    return next(AppError.badRequest("That file couldn't be uploaded. Use a CSV or Excel file."));
  });
}

/** Owner and Administrator can always import. Anyone else needs the import data permission on their role. */
export async function requireImportPermission(req: Request, _res: Response, next: NextFunction) {
  try {
    if (isFullAccessRole(req.user?.roleName)) return next();
    const roleId = req.user?.roleId;
    if (!roleId) return next(AppError.forbidden("Importing data is limited to administrators."));
    const [role] = await db.select({ permissions: roles.permissions }).from(roles).where(eq(roles.id, roleId));
    if (!roleHasImportPermission(req.user?.roleName, role?.permissions)) return next(AppError.forbidden("Importing data is limited to administrators."));
    next();
  } catch (err) {
    next(err);
  }
}

function present(row: typeof dataImports.$inferSelect, extra: Record<string, unknown> = {}) {
  return {
    id: row.id,
    entityKey: row.entityKey,
    fileName: row.fileName,
    fileSize: row.fileSize,
    status: row.status,
    badRowMode: row.badRowMode,
    duplicateMode: row.duplicateMode,
    sendInvites: row.sendInvites,
    mapping: row.mapping,
    totalRows: row.totalRows,
    processedRows: row.processedRows,
    createdCount: row.createdCount,
    updatedCount: row.updatedCount,
    skippedCount: row.skippedCount,
    failedCount: row.failedCount,
    headers: row.headers,
    sample: row.sample,
    problems: row.problems ?? [],
    hasErrorReport: Boolean(row.errorReportPath),
    message: row.message,
    startedBy: row.startedBy,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    ...extra,
  };
}

async function loadJob(id: number) {
  const [row] = await db.select().from(dataImports).where(eq(dataImports.id, id));
  if (!row) throw AppError.notFound("Import");
  return row;
}

function readOptions(body: unknown, headers: string[], entry: NonNullable<ReturnType<typeof getCatalogEntry>>) {
  const parsed = optionsSchema.safeParse(body);
  if (!parsed.success) throw AppError.badRequest("The import options weren't understood. Choose the columns again.");
  const mapping = parsed.data.mapping;
  for (const field of entry.entity.fields) {
    const column = mapping[field.key];
    if (field.required && (column === null || column === undefined)) throw AppError.badRequest(`Pick which column holds "${field.label}".`);
    if (column != null && (!Number.isInteger(column) || column < 0 || column >= headers.length)) throw AppError.badRequest(`The column chosen for "${field.label}" isn't in the file.`);
  }
  return {
    mapping,
    badRowMode: parsed.data.badRowMode,
    duplicateMode: parsed.data.duplicateMode,
    sendInvites: entry.supportsInvites === true && parsed.data.sendInvites === true,
  };
}

export const listImportTypes = asyncHandler(async (_req: Request, res: Response) => {
  res.json({
    maxBytes: env.IMPORT_MAX_BYTES,
    syncRowLimit: SYNC_ROW_LIMIT,
    types: IMPORT_CATALOG.map((entry) => ({
      key: entry.key,
      label: entry.label,
      description: entry.description,
      supportsInvites: entry.supportsInvites === true,
      fields: entry.entity.fields,
    })),
  });
});

export const templateHandler = asyncHandler(async (req: Request, res: Response) => {
  const entry = getCatalogEntry(String(req.params.key));
  if (!entry) throw AppError.notFound("Import type");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Import");
  sheet.addRow(entry.entity.fields.map((field) => field.label));
  sheet.addRow(entry.entity.fields.map((field) => field.example ?? ""));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(2).font = { italic: true, color: { argb: "FF888888" } };
  entry.entity.fields.forEach((_, index) => (sheet.getColumn(index + 1).width = 26));
  const notes = workbook.addWorksheet("Notes");
  notes.addRow(["Column", "Required?", "Notes"]).font = { bold: true };
  for (const field of entry.entity.fields) notes.addRow([field.label, field.required ? "Yes" : "No", field.help ?? ""]);
  notes.addRow([]);
  notes.addRow(["Delete the grey example row before importing. Only the first sheet is read."]);
  notes.getColumn(1).width = 28;
  notes.getColumn(3).width = 80;
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${entry.key}-import-template.xlsx"`);
  res.send(buffer);
});

export const listImports = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      id: dataImports.id,
      entityKey: dataImports.entityKey,
      fileName: dataImports.fileName,
      status: dataImports.status,
      totalRows: dataImports.totalRows,
      createdCount: dataImports.createdCount,
      updatedCount: dataImports.updatedCount,
      skippedCount: dataImports.skippedCount,
      failedCount: dataImports.failedCount,
      message: dataImports.message,
      startedBy: dataImports.startedBy,
      startedByName: users.name,
      startedByEmail: users.email,
      createdAt: dataImports.createdAt,
      completedAt: dataImports.completedAt,
      hasErrorReport: dataImports.errorReportPath,
    })
    .from(dataImports)
    .leftJoin(users, eq(users.id, dataImports.startedBy))
    .orderBy(desc(dataImports.createdAt))
    .limit(100);
  res.json(rows.map((row) => ({ ...row, hasErrorReport: Boolean(row.hasErrorReport), startedByName: row.startedByName || row.startedByEmail })));
});

export const getImport = asyncHandler(async (req: Request, res: Response) => {
  res.json(present(await loadJob(Number(req.params.id))));
});

export const downloadErrors = asyncHandler(async (req: Request, res: Response) => {
  const job = await loadJob(Number(req.params.id));
  if (!job.errorReportPath) throw AppError.notFound("Error report");
  const filePath = insideStorage(job.errorReportPath);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="import-${job.id}-errors.csv"`);
  createReadStream(filePath).pipe(res);
});

export const uploadImport = asyncHandler(async (req: Request, res: Response) => {
  const entry = getCatalogEntry(String(req.body.entityKey ?? ""));
  if (!entry) throw AppError.badRequest("Choose what kind of data this file is.");
  const file = req.file;
  if (!file) throw AppError.badRequest("Choose a CSV or Excel file to import.");
  const stored = path.resolve(file.path);
  const root = path.resolve(env.STORAGE_LOCAL_PATH) + path.sep;
  if (!stored.startsWith(root)) throw AppError.badRequest("That file couldn't be uploaded. Use a CSV or Excel file.");
  const lower = file.originalname.toLowerCase();
  if (!lower.endsWith(".csv") && !lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
    await unlink(stored).catch(() => undefined);
    throw AppError.badRequest("Upload a CSV or Excel file (.csv, .xlsx, or .xls).");
  }
  const sniffed = sniffSpreadsheet(await readFile(stored), file.originalname);
  if (!sniffed) {
    await unlink(stored).catch(() => undefined);
    throw AppError.badRequest("Upload a CSV or Excel file (.csv, .xlsx, or .xls).");
  }

  const sample: string[][] = [];
  let scanned: { headers: string[]; totalRows: number };
  try {
    scanned = await scanSpreadsheet(stored, file.originalname, async (row) => {
      if (sample.length < 5) sample.push(row.cells);
    });
  } catch (err) {
    await unlink(stored).catch(() => undefined);
    throw err;
  }

  const mapping = suggestMapping(entry.entity, scanned.headers);
  const [created] = await db
    .insert(dataImports)
    .values({
      entityKey: entry.key,
      fileName: file.originalname,
      filePath: stored,
      fileSize: file.size,
      mimeType: sniffed.mime,
      status: "uploaded",
      totalRows: scanned.totalRows,
      headers: scanned.headers,
      sample,
      mapping,
      startedBy: req.user?.id,
    })
    .returning();
  res.status(201).json({
    ...present(created!),
    label: entry.label,
    description: entry.description,
    supportsInvites: entry.supportsInvites === true,
    fields: entry.entity.fields,
  });
});

async function saveOptions(req: Request, status: "checking" | "running") {
  const job = await loadJob(Number(req.params.id));
  if (job.status === "running" || job.status === "checking") throw AppError.badRequest("This import is already running.");
  if (job.status === "completed") throw AppError.badRequest("This import already finished. Upload the file again to run another one.");
  const entry = getCatalogEntry(job.entityKey);
  if (!entry) throw AppError.badRequest("That kind of data can't be imported.");
  const options = readOptions(req.body, job.headers ?? [], entry);
  await db
    .update(dataImports)
    .set({
      status,
      mapping: options.mapping,
      badRowMode: options.badRowMode,
      duplicateMode: options.duplicateMode,
      sendInvites: options.sendInvites,
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      processedRows: 0,
      problems: [],
      message: null,
      errorReportPath: null,
      completedAt: null,
    })
    .where(eq(dataImports.id, job.id));
  return job;
}

export const checkImportHandler = asyncHandler(async (req: Request, res: Response) => {
  const job = await saveOptions(req, "checking");
  if (job.totalRows <= SYNC_ROW_LIMIT) await executeImport(job.id);
  else scheduleImport(job.id);
  res.json(present(await loadJob(job.id)));
});

export const runImportHandler = asyncHandler(async (req: Request, res: Response) => {
  const job = await saveOptions(req, "running");
  if (job.totalRows <= SYNC_ROW_LIMIT) {
    await executeImport(job.id);
    res.json(present(await loadJob(job.id)));
    return;
  }
  scheduleImport(job.id);
  res.status(202).json(present(await loadJob(job.id)));
});
