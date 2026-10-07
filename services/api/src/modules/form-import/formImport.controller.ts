import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import { controlledFormTemplates } from "../../drizzle/schema/controlledForms.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { getUserAccessLevel } from "../../middleware/departmentAccess.js";
import { ensureFormTemplates } from "../document-folders/formTemplates.js";
import { executeFormImport as runFormImport, planFormImport, type PlannedRow } from "./formImport.execute.js";
import { suggestMapping } from "./formImport.match.js";
import { interpretGrid, parseImportFile, type InterpretedImport } from "./formImport.parse.js";
import { FORM_IMPORT_TEMPLATES, getFormImportTemplate, type FormImportTemplate } from "./formImport.templates.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

const importBody = z.object({
  templateKey: z.string().min(1).max(80),
  columns: z.array(z.object({ index: z.number().int().nonnegative(), header: z.string().max(300) })).max(60),
  records: z
    .array(z.object({ rowNumber: z.number().int().positive(), cells: z.array(z.string().max(4000)).max(60) }))
    .max(500),
  mapping: z.record(z.string().max(40), z.number().int().nonnegative().nullable()),
});

export function uploadImportFile(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    const code = typeof err === "object" && err && "code" in err ? String(err.code) : "";
    if (code === "LIMIT_FILE_SIZE") return next(AppError.badRequest("That file is too large. Keep it under 8 MB."));
    return next(AppError.badRequest("That file couldn't be uploaded. Upload a CSV, Excel (.xls or .xlsx), or JSON file."));
  });
}

async function assertDocuments(req: Request, write: boolean) {
  if (!req.user || !req.db) throw AppError.unauthorized("Not signed in");
  const level = await getUserAccessLevel(req.db, { id: req.user.id, roleName: req.user.roleName, department: req.user.department }, "documents");
  if (level === "none") throw AppError.forbidden("No access to 'documents' for your department");
  if (write && level !== "edit") throw AppError.forbidden("'documents' is read-only for your department");
}

function presentRow(template: FormImportTemplate, row: PlannedRow) {
  return {
    rowNumber: row.rowNumber,
    action: row.action,
    summary: row.summary,
    issues: row.issues,
    notes: row.notes,
    values: template.fields
      .filter((field) => row.values[field.key])
      .map((field) => ({ key: field.key, label: field.label, value: row.values[field.key] })),
  };
}

export const listFormImportTemplates = asyncHandler(async (req, res) => {
  await assertDocuments(req, false);
  await ensureFormTemplates(req.db!, req.user?.id);
  const rows = await req.db!.select().from(controlledFormTemplates);
  res.json({
    accept: ".csv,.xls,.xlsx,.json",
    maxBytes: 8 * 1024 * 1024,
    templates: FORM_IMPORT_TEMPLATES.map((template) => {
      const row = rows.find((item) => item.formKey === template.key);
      const stored = row?.formId?.trim() ?? "";
      return {
        key: template.key,
        title: row?.title || template.title,
        printedId: template.printedId,
        formId: stored,
        displayNumber: stored || template.printedId,
        templateId: row?.id ?? null,
        subjectRoute: row?.subjectRoute ?? template.listPath,
        openPath: template.openPath,
        listPath: template.listPath,
        shape: template.shape,
        fields: template.fields.map((field) => ({
          key: field.key,
          label: field.label,
          group: field.group,
          required: Boolean(field.required),
          valueType: field.valueType,
          identity: field.identity ?? null,
        })),
      };
    }),
  });
});

export const inspectFormImport = asyncHandler(async (req, res) => {
  await assertDocuments(req, false);
  const template = getFormImportTemplate(String(req.body?.templateKey ?? ""));
  if (!template) throw AppError.badRequest("Choose a form template to import into.");
  const file = req.file;
  if (!file) throw AppError.badRequest("Choose a file to import.");
  const grid = await parseImportFile(file.buffer, file.originalname || "upload");
  const interpreted: InterpretedImport = interpretGrid(grid, template);
  if (interpreted.columns.length === 0 || interpreted.records.length === 0) {
    throw AppError.badRequest("That file has no rows to import. Check that it includes a header or the form's labels.");
  }
  const mapping = suggestMapping(template.fields, interpreted.columns);
  res.json({
    templateKey: template.key,
    fileName: file.originalname,
    mode: interpreted.mode,
    notes: interpreted.notes,
    truncated: interpreted.truncated,
    columns: interpreted.columns,
    records: interpreted.records,
    mapping,
  });
});

async function readBody(req: Request) {
  const parsed = importBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest("The import wasn't understood. Map the columns and try again.");
  const template = getFormImportTemplate(parsed.data.templateKey);
  if (!template) throw AppError.badRequest("Choose a form template to import into.");
  const allowed = new Set(template.fields.map((field) => field.key));
  const mapping: Record<string, number | null> = {};
  for (const [key, column] of Object.entries(parsed.data.mapping)) {
    if (!allowed.has(key)) continue;
    mapping[key] = column;
  }
  for (const field of template.fields) {
    if (!(field.key in mapping)) mapping[field.key] = null;
  }
  return { template, body: parsed.data, mapping };
}

export const previewFormImport = asyncHandler(async (req, res) => {
  await assertDocuments(req, false);
  const { template, body, mapping } = await readBody(req);
  const planned = await planFormImport(req.db!, template, body.records, mapping);
  const ready = planned.filter((row) => row.action !== "skip").length;
  res.json({
    templateKey: template.key,
    ready,
    skipped: planned.length - ready,
    rows: planned.map((row) => presentRow(template, row)),
  });
});

export const executeFormImport = asyncHandler(async (req, res) => {
  await assertDocuments(req, true);
  const { template, body, mapping } = await readBody(req);
  const planned = await planFormImport(req.db!, template, body.records, mapping);
  const outcome = await runFormImport(
    req.db!,
    { id: req.user!.id, roleName: req.user!.roleName },
    template,
    planned,
  );
  const wrote = outcome.created.length + outcome.updated.length;
  res.status(wrote > 0 ? 201 : 200).json({
    templateKey: template.key,
    listPath: template.listPath,
    ...outcome,
    skippedDetails: planned.filter((row) => row.action === "skip").map((row) => presentRow(template, row)),
  });
});
