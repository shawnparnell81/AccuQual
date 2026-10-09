import type { Request, Response } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { qmsForms, qmsFormRows } from "../../drizzle/schema/qmsForms.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { requireSignatureStamp } from "../signatures/signaturePin.service.js";
import { retainSignatureValues } from "../signatures/signaturePin.js";
import { showsRequiredControl, writeSignatureRequiredAudit } from "../signatures/signatureRequired.js";
import { deleteRecord } from "../records/recordDeletion.js";
import { isFullAccessRole } from "../roles/roleAccess.js";
import { keptRevision, templateRevisionFor } from "../forms/templateRevision.js";
import { fileBlankCopy, fileOnFirstSave } from "../document-folders/defaultFormFiling.js";
import { auditTrail } from "../../drizzle/schema/auditTrail.js";
import { cellLabel, scalarEdits, showAuditValue, type FormEdit } from "../forms/formEditAudit.js";
import { getQmsFormDefinition, isRetiredQmsFormType, liveQmsFormDefinitions } from "./qmsFormDefinitions.js";
import { QMS_NUMBER } from "../records/recordNumberSpecs.js";
import { applyRecordNumber, changesWithNumberEdit } from "../records/userRecordNumber.js";
import { stampRecordSite } from "../sites/recordSite.js";

async function loadForm(req: Request, id: number) {
  const [row] = await req.db!.select().from(qmsForms).where(and(eq(qmsForms.id, id)));
  if (!row) throw AppError.notFound("QMS form");
  return row;
}

export const listQmsFormTypesHandler = asyncHandler(async (_req: Request, res: Response) => {
  res.json(liveQmsFormDefinitions());
});

export const listQmsFormsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { formType, status } = req.query as Record<string, string | undefined>;
  const conditions = [];
  if (formType) conditions.push(eq(qmsForms.formType, formType));
  if (status) conditions.push(eq(qmsForms.status, status));
  const rows = await req.db!.select().from(qmsForms).where(and(...conditions)).orderBy(desc(qmsForms.createdAt));
  res.json(rows);
});

export const createQmsFormHandler = asyncHandler(async (req: Request, res: Response) => {
  const { formType } = req.body as { formType: string };
  if (isRetiredQmsFormType(formType)) throw AppError.badRequest("Master Document Register is retired. Use the Master Document List.");
  const definition = getQmsFormDefinition(formType);
  if (!definition) throw AppError.badRequest(`Unknown form type "${formType}"`);
  const revision = templateRevisionFor(`qms:${formType}`).revision;
  const body = { ...(req.body as Record<string, unknown>) };
  await applyRecordNumber(req.db!, body, QMS_NUMBER);
  const [created] = await req.db!.insert(qmsForms).values({ ...body, revision, createdBy: req.user?.id } as typeof qmsForms.$inferInsert).returning();
  await stampRecordSite(req.db!, "qms_forms", created!.id, req.siteId);
  await recordAuditTrail(req.db!, { entityType: "QmsForm", entityId: created!.id, action: "create", changes: req.body, performedBy: req.user?.id });
  await fileBlankCopy(req.db!, "/qms-forms", created as Record<string, unknown>, req.user?.id);
  res.status(201).json(created);
});

interface QmsRowSnapshot {
  id: number;
  sectionKey: string;
  data: Record<string, string>;
  sortOrder: number;
}

interface QmsEditSnapshot {
  formNo: string | null;
  revision: string | null;
  effectiveDate: string | null;
  preparedBy: string | null;
  approvedBy: string | null;
  status: string;
  additionalComments: string | null;
  rows: QmsRowSnapshot[];
}

function asSnapshot(value: unknown): QmsEditSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<QmsEditSnapshot>;
  if (!Array.isArray(row.rows) || typeof row.status !== "string") return null;
  return row as QmsEditSnapshot;
}

function dateIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return value;
}

export const beginQmsEditHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw AppError.badRequest("Record is required");
  const record = await loadForm(req, id);
  const rows = await req.db!.select().from(qmsFormRows).where(eq(qmsFormRows.formId, record.id)).orderBy(asc(qmsFormRows.sectionKey), asc(qmsFormRows.sortOrder), asc(qmsFormRows.id));
  const snapshot: QmsEditSnapshot = {
    formNo: record.formNo,
    revision: record.revision,
    effectiveDate: dateIso(record.effectiveDate),
    preparedBy: record.preparedBy,
    approvedBy: record.approvedBy,
    status: record.status,
    additionalComments: record.additionalComments,
    rows: rows.map((row) => ({ id: row.id, sectionKey: row.sectionKey, data: { ...(row.data ?? {}) }, sortOrder: row.sortOrder })),
  };
  await recordAuditTrail(req.db!, {
    entityType: "QmsForm",
    entityId: record.id,
    action: "update",
    changes: { event: "edit_started", snapshot },
    performedBy: req.user?.id,
  });
  res.json({ editing: true });
});

export const cancelQmsEditHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw AppError.badRequest("Record is required");
  const record = await loadForm(req, id);
  const history = await req.db!
    .select()
    .from(auditTrail)
    .where(and(eq(auditTrail.entityType, "QmsForm"), eq(auditTrail.entityId, record.id)))
    .orderBy(desc(auditTrail.createdAt), desc(auditTrail.id));
  const started = history.find((entry) => entry.changes?.event === "edit_started");
  const snapshot = asSnapshot(started?.changes?.snapshot);
  if (!snapshot) {
    res.json(record);
    return;
  }
  const currentRows = await req.db!.select().from(qmsFormRows).where(eq(qmsFormRows.formId, record.id));
  const snapIds = new Set(snapshot.rows.map((row) => row.id));
  const edits: FormEdit[] = scalarEdits(
    {
      formNo: record.formNo,
      revision: record.revision,
      effectiveDate: dateIso(record.effectiveDate),
      preparedBy: record.preparedBy,
      approvedBy: record.approvedBy,
      status: record.status,
      additionalComments: record.additionalComments,
    },
    {
      formNo: snapshot.formNo,
      revision: snapshot.revision,
      effectiveDate: snapshot.effectiveDate,
      preparedBy: snapshot.preparedBy,
      approvedBy: snapshot.approvedBy,
      status: snapshot.status,
      additionalComments: snapshot.additionalComments,
    },
    ["formNo", "revision", "effectiveDate", "preparedBy", "approvedBy", "status", "additionalComments"],
  );
  for (const row of currentRows) {
    if (snapIds.has(row.id)) continue;
    edits.push({ label: row.sectionKey, from: "added during edit", to: "(removed)" });
    await req.db!.delete(qmsFormRows).where(eq(qmsFormRows.id, row.id));
  }
  for (const snap of snapshot.rows) {
    const existing = currentRows.find((row) => row.id === snap.id);
    if (!existing) {
      edits.push({ label: snap.sectionKey, from: "(removed)", to: "restored" });
      await req.db!.insert(qmsFormRows).values({ formId: record.id, sectionKey: snap.sectionKey, data: snap.data, sortOrder: snap.sortOrder });
      continue;
    }
    for (const edit of scalarEdits(existing.data ?? {}, snap.data ?? {})) {
      edits.push({ ...edit, label: `${snap.sectionKey} ${edit.label}` });
    }
    await req.db!
      .update(qmsFormRows)
      .set({ sectionKey: snap.sectionKey, data: snap.data, sortOrder: snap.sortOrder, updatedAt: new Date() })
      .where(eq(qmsFormRows.id, existing.id));
  }
  const [updated] = await req.db!
    .update(qmsForms)
    .set({
      formNo: snapshot.formNo,
      revision: snapshot.revision,
      effectiveDate: snapshot.effectiveDate ? new Date(snapshot.effectiveDate) : null,
      preparedBy: snapshot.preparedBy,
      approvedBy: snapshot.approvedBy,
      status: snapshot.status,
      additionalComments: snapshot.additionalComments,
      updatedAt: new Date(),
    })
    .where(eq(qmsForms.id, record.id))
    .returning();
  await recordAuditTrail(req.db!, {
    entityType: "QmsForm",
    entityId: record.id,
    action: "update",
    changes: { event: "edit_reverted", edits },
    performedBy: req.user?.id,
  });
  res.json(updated);
});

export const getQmsFormHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadForm(req, Number(req.params.id));
  const rows = await req.db!.select().from(qmsFormRows).where(and(eq(qmsFormRows.formId, record.id))).orderBy(asc(qmsFormRows.sectionKey), asc(qmsFormRows.sortOrder), asc(qmsFormRows.id));
  const definition = getQmsFormDefinition(record.formType);
  res.json({ ...record, definition, rows });
});

export const updateQmsFormHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadForm(req, Number(req.params.id));
  const nextStatus = (req.body as { status?: string }).status;
  if (record.status === "obsolete" && nextStatus && nextStatus !== "obsolete" && !isFullAccessRole(req.user?.roleName)) {
    throw AppError.forbidden("Only an Owner or Administrator can restore an obsolete form.");
  }
  const body = { ...(req.body as Record<string, unknown>) };
  delete body.revision;
  const numberChange = await applyRecordNumber(req.db!, body, QMS_NUMBER, { id: record.id, current: record.formNo, row: record });
  const revision = keptRevision(record.revision, templateRevisionFor(`qms:${record.formType}`).revision);
  const [updated] = await req.db!.update(qmsForms).set({ ...body, revision, updatedAt: new Date() }).where(eq(qmsForms.id, record.id)).returning();
  const headerEdits = scalarEdits(record as unknown as Record<string, unknown>, { ...(record as unknown as Record<string, unknown>), ...body }, Object.keys(body));
  const headerChanges = headerEdits.length
    ? { ...changesWithNumberEdit({}, numberChange), event: "form_saved", edits: headerEdits }
    : changesWithNumberEdit(req.body, numberChange);
  await recordAuditTrail(req.db!, { entityType: "QmsForm", entityId: record.id, action: "update", changes: headerChanges, performedBy: req.user?.id });
  await fileOnFirstSave(req.db!, "/qms-forms", record, updated as Record<string, unknown>, body, req.user?.id);
  res.json(updated);
});

export const deleteQmsFormHandler = asyncHandler(async (req: Request, res: Response) => {
  await deleteRecord(req, "qms");
  res.status(204).send();
});

// ---- Generic rows (one of the formType's own named table sections — see qmsFormDefinitions.ts) ----

async function loadRow(req: Request, formId: number, rowId: number) {
  const [row] = await req.db!.select().from(qmsFormRows).where(and(eq(qmsFormRows.id, rowId), eq(qmsFormRows.formId, formId)));
  if (!row) throw AppError.notFound("Row");
  return row;
}

export const createQmsFormRowHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadForm(req, Number(req.params.id));
  const definition = getQmsFormDefinition(record.formType);
  const { sectionKey, data } = req.body as { sectionKey: string; data?: Record<string, string> };
  if (!definition?.sections.some((s) => s.key === sectionKey)) throw AppError.badRequest(`"${sectionKey}" is not a real section of "${record.formType}"`);
  const safeData = retainSignatureValues({}, data ?? {}) as Record<string, string>;
  const [created] = await req.db!.insert(qmsFormRows).values({ formId: record.id, sectionKey, data: safeData }).returning();
  await recordAuditTrail(req.db!, { entityType: "QmsForm", entityId: record.id, action: "update", changes: { subAction: "row_added", sectionKey }, performedBy: req.user?.id });
  res.status(201).json(created);
});

function choiceText(value: unknown): "yes" | "no" {
  return value === "no" ? "no" : "yes";
}

/** Names the column from the form definition and the row's place in that section. */
function qmsRowEdits(
  section: { columns: { key: string; label: string }[] } | undefined,
  rowNumber: number,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys: string[],
): FormEdit[] {
  const edits: FormEdit[] = [];
  for (const key of keys) {
    if (key.startsWith("_") || key === "signature" || key === "signatureRequired") continue;
    const from = before[key];
    const to = after[key];
    if ((from ?? "") === (to ?? "")) continue;
    const column = section?.columns.find((item) => item.key === key)?.label ?? cellLabel(key);
    edits.push({ label: `Row ${rowNumber} ${column}`, from: showAuditValue(from), to: showAuditValue(to) });
  }
  return edits;
}

export const updateQmsFormRowHandler = asyncHandler(async (req: Request, res: Response) => {
  const formId = Number(req.params.id);
  const rowId = Number(req.params.rowId);
  // Hold the row until this request commits, so overlapping cell saves merge instead of replacing each other.
  await req.db!.execute(sql`SELECT 1 FROM "qms_form_rows" WHERE "id" = ${rowId} AND "form_id" = ${formId} FOR UPDATE`);
  const record = await loadForm(req, formId);
  const row = await loadRow(req, record.id, rowId);
  const incoming = req.body.data as Record<string, string>;
  const before = { ...((row.data ?? {}) as Record<string, string>) };
  const data = retainSignatureValues(before, incoming) as Record<string, string>;
  const definition = getQmsFormDefinition(record.formType);
  const section = definition?.sections.find((item) => item.key === row.sectionKey);
  const ordered = await req.db!
    .select({ id: qmsFormRows.id })
    .from(qmsFormRows)
    .where(and(eq(qmsFormRows.formId, record.id), eq(qmsFormRows.sectionKey, row.sectionKey)))
    .orderBy(asc(qmsFormRows.sortOrder), asc(qmsFormRows.id));
  const rowNumber = Math.max(1, ordered.findIndex((item) => item.id === row.id) + 1);
  const signatureColumn = section?.columns.some((column) => column.key === "signature") === true;
  const multi = signatureColumn && showsRequiredControl(ordered.length);
  const previous = choiceText(before.signatureRequired);
  if (!multi) delete data.signatureRequired;
  else if (data.signatureRequired !== "yes" && data.signatureRequired !== "no") delete data.signatureRequired;
  const next = choiceText(data.signatureRequired);
  if (multi && previous !== next) {
    const label = `${section?.label ?? "Signature"} signature`;
    await writeSignatureRequiredAudit(req.db!, {
      entityType: "QmsForm",
      entityId: record.id,
      performedBy: req.user?.id,
      changes: [{ path: `row:${row.id}:signature`, label, from: previous, to: next }],
    });
  }
  const [updated] = await req.db!.update(qmsFormRows).set({ data, updatedAt: new Date() }).where(eq(qmsFormRows.id, row.id)).returning();
  const rowEdits = qmsRowEdits(section, rowNumber, before, data, Object.keys(incoming));
  await recordAuditTrail(req.db!, {
    entityType: "QmsForm",
    entityId: record.id,
    action: "update",
    changes: rowEdits.length ? { event: "form_saved", subAction: "row_updated", rowId: row.id, edits: rowEdits } : { subAction: "row_updated", rowId: row.id },
    performedBy: req.user?.id,
  });
  await fileOnFirstSave(req.db!, "/qms-forms", record, record as unknown as Record<string, unknown>, incoming, req.user?.id);
  await req.db!.update(qmsForms).set({ updatedAt: new Date() }).where(eq(qmsForms.id, record.id));
  res.json(updated);
});

export const signQmsFormRowHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadForm(req, Number(req.params.id));
  const row = await loadRow(req, record.id, Number(req.params.rowId));
  const stamp = await requireSignatureStamp(req, {
    pin: req.body.pin,
    certified: req.body.certified,
    entityType: "QmsForm",
    entityId: record.id,
    field: `row ${row.id} signature`,
    description: "I certify that this entry is accurate and complete.",
  });
  await req.db!.execute(sql`SELECT 1 FROM "qms_form_rows" WHERE "id" = ${row.id} AND "form_id" = ${record.id} FOR UPDATE`);
  const fresh = await loadRow(req, record.id, row.id);
  const data = { ...(fresh.data ?? {}) };
  data.signature = stamp.stamp;
  if (!data.date) data.date = stamp.signedOn;
  const [updated] = await req.db!.update(qmsFormRows).set({ data, updatedAt: new Date() }).where(eq(qmsFormRows.id, row.id)).returning();
  await fileOnFirstSave(req.db!, "/qms-forms", record, record as unknown as Record<string, unknown>, { signature: stamp.stamp }, req.user?.id);
  await req.db!.update(qmsForms).set({ updatedAt: new Date() }).where(eq(qmsForms.id, record.id));
  res.json({ ...updated, stamp: stamp.stamp, signedOn: stamp.signedOn });
});

export const deleteQmsFormRowHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadForm(req, Number(req.params.id));
  const row = await loadRow(req, record.id, Number(req.params.rowId));
  await req.db!.delete(qmsFormRows).where(eq(qmsFormRows.id, row.id));
  await recordAuditTrail(req.db!, { entityType: "QmsForm", entityId: record.id, action: "update", changes: { subAction: "row_removed", rowId: row.id }, performedBy: req.user?.id });
  res.status(204).send();
});
