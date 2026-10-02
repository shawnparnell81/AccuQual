import { and, eq } from "drizzle-orm";
import { controlledVersions } from "../../drizzle/schema/versioning.js";
import { documents } from "../../drizzle/schema/documents.js";
import { validationReports } from "../../drizzle/schema/validationReport.js";
import type { Db } from "../../lib/requestDb.js";
import { AI_STREAM, publishEvent } from "../../lib/eventBus.js";
import { snapshotFormNumber } from "../document-folders/formRecordFiling.js";
import { blankDocumentPayload, normalizeDocumentPayload } from "../documents/documentPayload.js";
import { documentAdapter } from "../documents/documentVersioning.js";
import { answersWithTemplateStamp } from "../forms/templateRevision.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { createInitialDraft, saveDraft, type Actor } from "../versioning/versioning.service.js";
import type { FormImportField, FormImportTemplate } from "./formImport.templates.js";

const TEMPLATE_NUMBER = /^(FRM|LST)-/i;
const DOC_NUMBER = /^DOC-(\d+)$/i;

export interface ImportRecordInput {
  rowNumber: number;
  cells: string[];
}

export interface PlannedRow {
  rowNumber: number;
  action: "create" | "update" | "skip";
  summary: string;
  issues: string[];
  notes: string[];
  values: Record<string, string>;
  matchId: number | null;
}

export interface ImportOutcome {
  created: { id: number; href: string; label: string }[];
  updated: { id: number; href: string; label: string }[];
  skipped: { rowNumber: number; summary: string }[];
}

function mappedRaw(cells: string[], column: number | null | undefined): string {
  if (column == null || column < 0) return "";
  return (cells[column] ?? "").trim();
}

function coerce(field: FormImportField, raw: string): { ok: true; value: string | number | boolean } | { ok: false; message: string } {
  if (field.valueType === "number") {
    const cleaned = raw.replace(/,/g, "");
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return { ok: false, message: `${field.label} must be a number.` };
    return { ok: true, value: Number(cleaned) };
  }
  if (field.valueType === "date") {
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return { ok: true, value: raw.slice(0, 10) };
    const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
    if (!match) return { ok: false, message: `${field.label} must be a date.` };
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return { ok: false, message: `${field.label} must be a date.` };
    return { ok: true, value: `${match[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
  }
  if (field.valueType === "boolean") {
    const token = raw.toLowerCase();
    if (["true", "yes", "y", "x", "1", "checked"].includes(token) || raw === "✓" || raw === "✔") return { ok: true, value: true };
    if (["false", "no", "n", "0", "unchecked"].includes(token)) return { ok: true, value: false };
    return { ok: false, message: `${field.label} must be yes or no.` };
  }
  if (field.valueType === "cell") {
    if (raw === "<=") return { ok: true, value: "≤" };
    if (raw === ">=") return { ok: true, value: "≥" };
    if (raw === "≤" || raw === "≥" || raw === "=") return { ok: true, value: raw };
    if (/^-?\d+(\.\d+)?$/.test(raw)) return { ok: true, value: Number(raw) };
    if (/^(true|yes)$/i.test(raw)) return { ok: true, value: true };
    if (/^(false|no)$/i.test(raw)) return { ok: true, value: false };
    return { ok: true, value: raw };
  }
  if (raw.length > 4000) return { ok: false, message: `${field.label} is too long.` };
  return { ok: true, value: raw };
}

function collectValues(fields: FormImportField[], cells: string[], mapping: Record<string, number | null>): { values: Record<string, string>; issues: string[] } {
  const values: Record<string, string> = {};
  const issues: string[] = [];
  for (const field of fields) {
    if (!(field.key in mapping)) continue;
    const raw = mappedRaw(cells, mapping[field.key]);
    if (!raw) {
      if (field.required) issues.push(`${field.label} is required.`);
      continue;
    }
    values[field.key] = raw;
  }
  for (const field of fields) {
    if (field.required && !(field.key in values) && !(field.key in mapping)) issues.push(`${field.label} is required.`);
  }
  return { values, issues };
}

async function planDocumentRow(db: Db, rowNumber: number, values: Record<string, string>, issues: string[]): Promise<PlannedRow> {
  const notes: string[] = [];
  const documentId = values.documentId ?? "";
  if (TEMPLATE_NUMBER.test(documentId)) {
    return {
      rowNumber,
      action: "skip",
      summary: `${documentId.toUpperCase()} stays on the list as a form template. Import does not create another number for it.`,
      issues: [],
      notes: [],
      values,
      matchId: null,
    };
  }
  const docMatch = DOC_NUMBER.exec(documentId);
  if (docMatch) {
    const id = Number(docMatch[1]);
    const [doc] = await db.select().from(documents).where(eq(documents.id, id));
    if (!doc || doc.isDeleted) {
      return { rowNumber, action: "skip", summary: `DOC-${id} is not on the list.`, issues: [], notes, values, matchId: null };
    }
    if (doc.status !== "draft") {
      return {
        rowNumber,
        action: "skip",
        summary: `DOC-${id} is ${doc.status}. Import fills drafts only, so the approved revision stays as it is.`,
        issues: [],
        notes,
        values,
        matchId: id,
      };
    }
    if (!values.title) issues.push("Document Title is required.");
    if ((values.revision ?? "").length > 20) issues.push("Current Rev must be 20 characters or fewer.");
    return {
      rowNumber,
      action: issues.length ? "skip" : "update",
      summary: issues.length ? "This draft was not changed." : `Update draft DOC-${id}.`,
      issues,
      notes,
      values,
      matchId: id,
    };
  }
  if (documentId) notes.push(`${documentId} was not used as a document number. A new draft gets the next DOC number.`);
  if (values.revision) notes.push("Current Rev is stored on the draft. It appears on the Master Document List after that draft is published.");
  if (values.notes) notes.push("Notes are stored on the draft. Rev history on the list updates when that draft is published.");
  if (!values.title) issues.push("Document Title is required.");
  if ((values.revision ?? "").length > 20) issues.push("Current Rev must be 20 characters or fewer.");
  if ((values.location ?? "").length > 200) issues.push("Location / Folder is too long.");
  return {
    rowNumber,
    action: issues.length ? "skip" : "create",
    summary: issues.length ? "This row was not imported." : "New draft document.",
    issues,
    notes,
    values,
    matchId: null,
  };
}

function planValidationRow(fields: FormImportField[], rowNumber: number, values: Record<string, string>, issues: string[]): PlannedRow {
  for (const field of fields) {
    const raw = values[field.key];
    if (!raw) continue;
    const coerced = coerce(field, raw);
    if (!coerced.ok) issues.push(coerced.message);
  }
  if (Object.keys(values).length === 0) issues.push("Nothing in this row is mapped onto the form.");
  return {
    rowNumber,
    action: issues.length ? "skip" : "create",
    summary: issues.length ? "This row was not imported." : "New CSA validation report.",
    issues,
    notes: [],
    values,
    matchId: null,
  };
}

export async function planFormImport(
  db: Db,
  template: FormImportTemplate,
  records: ImportRecordInput[],
  mapping: Record<string, number | null>,
): Promise<PlannedRow[]> {
  const planned: PlannedRow[] = [];
  for (const record of records) {
    const collected = collectValues(template.fields, record.cells, mapping);
    if (template.persist.kind === "document") planned.push(await planDocumentRow(db, record.rowNumber, collected.values, collected.issues));
    else planned.push(planValidationRow(template.fields, record.rowNumber, collected.values, collected.issues));
  }
  return planned;
}

function hrefFor(template: FormImportTemplate, id: number): string {
  return template.openPath.replace("{id}", String(id));
}

type WriteResult = { kind: "skip"; summary: string } | { kind: "create" | "update"; id: number; href: string; label: string };

async function writeDocument(db: Db, actor: Actor, template: FormImportTemplate, row: PlannedRow): Promise<WriteResult> {
  const title = row.values.title!.trim();
  const category = row.values.location?.trim() || null;
  const revision = row.values.revision?.trim() || "";
  const notes = row.values.notes?.trim() || "";
  if (row.action === "update" && row.matchId != null) {
    const id = row.matchId;
    const [draft] = await db
      .select()
      .from(controlledVersions)
      .where(and(eq(controlledVersions.subjectType, "document"), eq(controlledVersions.subjectId, id), eq(controlledVersions.status, "draft")));
    if (!draft) return { kind: "skip", summary: `DOC-${id} has no open draft to fill.` };
    const current = normalizeDocumentPayload((draft.payload ?? {}) as Record<string, unknown>);
    const next = {
      ...current,
      title,
      category: "location" in row.values ? category : current.category,
      revisionCode: "revision" in row.values && revision ? revision : current.revisionCode,
      content: "notes" in row.values && notes ? notes : current.content,
    };
    await saveDraft(db, documentAdapter, id, draft.id, actor, { payload: next as unknown as Record<string, unknown> });
    await db
      .update(documents)
      .set({ title, ...("location" in row.values ? { category } : {}), updatedAt: new Date() })
      .where(eq(documents.id, id));
    await recordAuditTrail(db, {
      entityType: "Document",
      entityId: id,
      action: "update",
      changes: { source: "form_import", templateKey: template.key, title, category },
      performedBy: actor.id,
    });
    return { kind: "update", id, href: hrefFor(template, id), label: title };
  }

  const [doc] = await db
    .insert(documents)
    .values({ title, category, status: "draft", currentVersion: 0, ownerId: actor.id })
    .returning();
  if (!doc) throw new Error("Failed to create the document");
  const payload = {
    ...blankDocumentPayload(),
    title,
    category,
    revisionCode: revision || "Rev A",
    content: notes,
  };
  await createInitialDraft(db, documentAdapter, doc.id, actor, payload as unknown as Record<string, unknown>);
  await recordAuditTrail(db, {
    entityType: "Document",
    entityId: doc.id,
    action: "create",
    changes: { source: "form_import", templateKey: template.key, title, category },
    performedBy: actor.id,
  });
  return { kind: "create", id: doc.id, href: hrefFor(template, doc.id), label: `DOC-${doc.id} ${title}` };
}

async function writeValidation(db: Db, actor: Actor, template: FormImportTemplate, row: PlannedRow): Promise<WriteResult> {
  const persist = template.persist;
  if (persist.kind !== "validation_report") throw new Error("Not a validation template");
  const cells: Record<string, string | number | boolean> = {};
  for (const field of template.fields) {
    const raw = row.values[field.key];
    if (!raw) continue;
    const coerced = coerce(field, raw);
    if (!coerced.ok) {
      row.issues.push(coerced.message);
      continue;
    }
    cells[field.key] = coerced.value;
  }
  if (Object.keys(cells).length === 0) {
    return { kind: "skip", summary: row.issues[0] || "Nothing in this row is mapped onto the form." };
  }
  const data = answersWithTemplateStamp(persist.stampKey, undefined, { formType: persist.formType, cells }, true);
  const [created] = await db.insert(validationReports).values({ data }).returning();
  if (!created) throw new Error("Failed to create the validation report");
  await recordAuditTrail(db, {
    entityType: "Validation Report",
    entityId: created.id,
    action: "create",
    changes: { source: "form_import", templateKey: template.key, data },
    performedBy: actor.id,
  });
  await publishEvent(AI_STREAM, { job: "embed", entityType: "Validation Report", entityId: created.id, content: JSON.stringify(data) });
  await snapshotFormNumber(db, persist.formKey, created.id);
  const part = typeof cells.B6 === "string" && cells.B6 ? cells.B6 : `Report ${created.id}`;
  return { kind: "create", id: created.id, href: hrefFor(template, created.id), label: part };
}

export async function executeFormImport(db: Db, actor: Actor, template: FormImportTemplate, rows: PlannedRow[]): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { created: [], updated: [], skipped: [] };
  for (const row of rows) {
    if (row.action === "skip" || row.issues.length > 0) {
      outcome.skipped.push({ rowNumber: row.rowNumber, summary: row.issues[0] || row.summary });
      continue;
    }
    const written = template.persist.kind === "document" ? await writeDocument(db, actor, template, row) : await writeValidation(db, actor, template, row);
    if (written.kind === "skip") {
      outcome.skipped.push({ rowNumber: row.rowNumber, summary: written.summary });
      continue;
    }
    const bucket = written.kind === "update" ? outcome.updated : outcome.created;
    bucket.push({ id: written.id, href: written.href, label: written.label });
  }
  return outcome;
}
