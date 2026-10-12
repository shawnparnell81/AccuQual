import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import multer from "multer";
import { z } from "zod";
import { company } from "../../drizzle/schema/company.js";
import { controlledFormTemplates } from "../../drizzle/schema/controlledForms.js";
import { builtForms } from "../../drizzle/schema/builtForms.js";
import { users } from "../../drizzle/schema/users.js";
import type { Db } from "../../lib/requestDb.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { getUserAccessLevel } from "../../middleware/departmentAccess.js";
import { ensureFormTemplates } from "../document-folders/formTemplates.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { canFillBuiltForm } from "../form-builder/access.js";
import { formBuilderAccess, openBuiltFill, saveBuiltFill } from "../form-builder/service.js";
import { formatUserLabel } from "../users/userDisplay.js";
import { extractFile, type ExtractedFile } from "./extract.js";
import { executeFormImport as runFormImport, planFormImport, type PlannedRow } from "./formImport.execute.js";
import { suggestMapping } from "./formImport.match.js";
import { interpretGrid, parseImportFile, type InterpretedImport } from "./formImport.parse.js";
import { FORM_IMPORT_TEMPLATES, getFormImportTemplate, type FormImportTemplate } from "./formImport.templates.js";
import { proposeValues } from "./propose.js";
import { listImportTargets, targetFields, targetFieldsForFrm, type TargetField } from "./targets.js";
import { confirmImportSchema, proposeBodySchema } from "./formImport.validation.js";

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

/** Generic "Import from file" (Word/Excel/CSV) — extract and propose write nothing. Only confirm saves. */

function actorOf(req: Request) {
  if (!req.user) throw AppError.unauthorized("Not signed in");
  return { id: req.user.id, roleName: req.user.roleName, department: req.user.department };
}

interface ResolvedTarget {
  kind: "built" | "frm";
  title: string;
  revision: string;
  fields: TargetField[];
  builtId?: number;
  frmTemplate?: FormImportTemplate;
}

async function resolveTarget(req: Request, ref: string): Promise<ResolvedTarget> {
  if (ref.startsWith("built:")) {
    const id = Number(ref.slice("built:".length));
    if (!Number.isInteger(id) || id < 1) throw AppError.badRequest("Choose a form to import into.");
    const access = await formBuilderAccess(req.db!, actorOf(req));
    if (!canFillBuiltForm(access)) throw AppError.forbidden("You can view this form once Documents is turned on for you.");
    const [row] = await req.db!.select().from(builtForms).where(eq(builtForms.id, id));
    if (!row || row.status !== "published" || row.publishedStructure == null) {
      throw AppError.badRequest("Choose a published form to import into.");
    }
    return { kind: "built", title: row.title, revision: row.revision, fields: targetFields(row.publishedStructure), builtId: id };
  }
  if (ref.startsWith("frm:")) {
    const key = ref.slice("frm:".length);
    const template = getFormImportTemplate(key);
    if (!template) throw AppError.badRequest("Choose a form to import into.");
    await assertDocuments(req, false);
    return { kind: "frm", title: template.title, revision: "", fields: targetFieldsForFrm(template), frmTemplate: template };
  }
  throw AppError.badRequest("Choose a form to import into.");
}

async function who(db: Db, userId: number): Promise<{ label: string; when: string }> {
  const [person] = await db.select({ name: users.name, email: users.email, isActive: users.isActive }).from(users).where(eq(users.id, userId));
  const [profile] = await db.select({ profile: company.profile }).from(company).limit(1);
  const timeZone = profile?.profile?.timezone || "UTC";
  const when = new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date());
  return { label: formatUserLabel(person ? { ...person, isActive: person.isActive ?? true } : undefined, userId), when };
}

export const listImportTargetsHandler = asyncHandler(async (req, res) => {
  const targets = await listImportTargets(req.db!, actorOf(req));
  res.json({ targets });
});

export const extractFileHandler = asyncHandler(async (req, res) => {
  const file = req.file;
  if (!file) throw AppError.badRequest("Choose a file to import.");
  const extracted = await extractFile(file.buffer, file.originalname || "upload");
  res.json({ extracted, warnings: [] });
});

export const proposeValuesHandler = asyncHandler(async (req, res) => {
  const parsed = proposeBodySchema.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest("Choose a file and a target form.");
  const target = await resolveTarget(req, parsed.data.targetRef);
  const proposals = proposeValues(parsed.data.extracted as ExtractedFile, target.fields);
  res.json({ fields: target.fields, proposals });
});

function hasValue(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  return String(value).trim() !== "";
}

export const confirmImportHandler = asyncHandler(async (req, res) => {
  const parsed = confirmImportSchema.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest("That import could not be saved.");
  const body = parsed.data;
  const target = await resolveTarget(req, body.targetRef);
  const allowedKeys = new Set(target.fields.map((field) => field.key));
  for (const key of Object.keys(body.values)) {
    if (!allowedKeys.has(key)) throw AppError.badRequest(`"${key}" is not a field on this form.`);
  }
  const filled = target.fields.filter((field) => hasValue(body.values[field.key])).length;

  let openPath: string;
  let auditEntityType: string;
  let auditEntityId: number;

  if (target.kind === "built") {
    const actor = actorOf(req);
    const fill = await openBuiltFill(req.db!, actor, target.builtId!, body.recordNumber ?? null, req.siteId);
    await saveBuiltFill(req.db!, actor, fill.id, { title: body.title, answers: body.values as Record<string, unknown> });
    openPath = `/form-builder/fills/${fill.id}`;
    auditEntityType = "BuiltFormFill";
    auditEntityId = fill.id;
  } else {
    const template = target.frmTemplate!;
    const cells = template.fields.map((field) => {
      const value = body.values[field.key];
      return typeof value === "string" ? value : "";
    });
    const mapping: Record<string, number | null> = {};
    template.fields.forEach((field, index) => {
      mapping[field.key] = cells[index] ? index : null;
    });
    const planned = await planFormImport(req.db!, template, [{ rowNumber: 1, cells }], mapping);
    const outcome = await runFormImport(req.db!, { id: req.user!.id, roleName: req.user!.roleName }, template, planned);
    const written = outcome.created[0] ?? outcome.updated[0];
    if (!written) throw AppError.badRequest(planned[0]?.issues[0] || "Nothing in this file could be imported onto that form.");
    openPath = written.href;
    auditEntityType = template.persist.kind === "document" ? "Document" : "Validation Report";
    auditEntityId = written.id;
  }

  const person = await who(req.db!, req.user!.id);
  const revLabel = target.revision ? ` Rev ${target.revision}` : "";
  const edited = body.edited ?? 0;
  const summary = `${person.label} imported "${body.fileName}" into "${target.title}"${revLabel} on ${person.when}. ${filled} of ${target.fields.length} fields filled from the file; ${edited} edited in review.`;
  await recordAuditTrail(req.db!, {
    entityType: auditEntityType,
    entityId: auditEntityId,
    action: "create",
    changes: { summary, fileName: body.fileName, targetTitle: target.title, revision: target.revision, filled, edited },
    performedBy: req.user!.id,
  });

  res.status(201).json({ openPath });
});
