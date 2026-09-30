import { and, eq } from "drizzle-orm";
import { controlledFormTemplates } from "../../drizzle/schema/controlledForms.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import { formFilings } from "../../drizzle/schema/formFilings.js";
import { isoQualityForms } from "../../drizzle/schema/isoQualityForms.js";
import type { Db } from "../../lib/requestDb.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { AppError } from "../../utils/appError.js";
import { filedRecordName, fileNamePatternFor, FORM_TEMPLATES } from "./formFiling.js";
import { ensureFormTemplates } from "./formTemplates.js";
import {
  canEditFormNumber,
  EDITABLE_FORM_NUMBER_KEYS,
  FORM_DATA_TYPE_TO_FORM_KEY,
  ISO_TYPE_TO_FORM_KEY,
  SUGGESTED_SUBJECT_PATH,
  folderPathNames,
  recordLinkedPath,
  resolveFolderPath,
  type FolderNode,
} from "./editableForms.js";

const FOLDER_AUDIT = "DocumentFolder";
const TEMPLATE_AUDIT = "ControlledFormTemplate";

function seedFor(formKey: string) {
  return FORM_TEMPLATES.find((seed) => seed.formKey === formKey);
}

async function loadFolders(db: Db): Promise<FolderNode[]> {
  const rows = await db.select({ id: documentFolders.id, name: documentFolders.name, parentId: documentFolders.parentId }).from(documentFolders);
  return rows;
}

function suggestedFolderId(folders: FolderNode[], formKey: string, templateFolderId: number | null): number | null {
  const fromSubject = resolveFolderPath(folders, SUGGESTED_SUBJECT_PATH[formKey] ?? []);
  if (fromSubject != null) return fromSubject;
  return templateFolderId;
}

async function wouldCreateCycle(db: Db, folderId: number, candidateParentId: number): Promise<boolean> {
  let cursor: number | null = candidateParentId;
  const seen = new Set<number>();
  while (cursor !== null) {
    if (cursor === folderId) return true;
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    const [row] = await db.select({ parentId: documentFolders.parentId }).from(documentFolders).where(eq(documentFolders.id, cursor));
    cursor = row?.parentId ?? null;
  }
  return false;
}

export interface FormFilingView {
  formKey: string;
  recordId: number;
  formNumber: string;
  snapshotted: boolean;
  folderNodeId: number | null;
  parentId: number | null;
  parentPath: string[];
  suggestedFolderId: number | null;
  suggestedPath: string[];
  fileName: string | null;
}

async function presentFiling(db: Db, formKey: string, recordId: number, folders: FolderNode[]): Promise<FormFilingView> {
  const [template] = await db.select().from(controlledFormTemplates).where(eq(controlledFormTemplates.formKey, formKey));
  const [filing] = await db.select().from(formFilings).where(and(eq(formFilings.formKey, formKey), eq(formFilings.recordId, recordId)));
  const node = filing?.folderNodeId == null ? undefined : folders.find((folder) => folder.id === filing.folderNodeId);
  const parentId = node?.parentId ?? null;
  const suggestedId = suggestedFolderId(folders, formKey, template?.folderId ?? null);
  return {
    formKey,
    recordId,
    formNumber: filing?.formNumber ?? "",
    snapshotted: filing != null,
    folderNodeId: node?.id ?? null,
    parentId,
    parentPath: folderPathNames(folders, parentId),
    suggestedFolderId: suggestedId,
    suggestedPath: folderPathNames(folders, suggestedId),
    fileName: node?.name ?? null,
  };
}

/** Copies the master's current number onto a new filled record. Does nothing if a snapshot already exists. */
export async function snapshotFormNumber(db: Db, formKey: string, recordId: number): Promise<void> {
  if (!EDITABLE_FORM_NUMBER_KEYS.has(formKey) || !Number.isInteger(recordId) || recordId <= 0) return;
  const [existing] = await db.select({ id: formFilings.id }).from(formFilings).where(and(eq(formFilings.formKey, formKey), eq(formFilings.recordId, recordId)));
  if (existing) return;
  await ensureFormTemplates(db);
  const [template] = await db.select({ formId: controlledFormTemplates.formId }).from(controlledFormTemplates).where(eq(controlledFormTemplates.formKey, formKey));
  await db.insert(formFilings).values({ formKey, recordId, formNumber: template?.formId ?? "" });
}

export async function snapshotIsoFormNumber(db: Db, created: Record<string, unknown>): Promise<void> {
  const formType = typeof created.formType === "string" ? created.formType : "";
  const formKey = ISO_TYPE_TO_FORM_KEY[formType];
  const recordId = typeof created.id === "number" ? created.id : 0;
  if (!formKey) return;
  await snapshotFormNumber(db, formKey, recordId);
}

export async function snapshotFormDataNumber(db: Db, formType: string, entityId: number | null | undefined): Promise<void> {
  const formKey = FORM_DATA_TYPE_TO_FORM_KEY[formType];
  if (!formKey || entityId == null) return;
  await snapshotFormNumber(db, formKey, entityId);
}

export async function updateFormNumber(
  db: Db,
  formKey: string,
  formId: string,
  performedBy: number | undefined,
  actor: { roleName?: string | null; department?: string | null } | null | undefined,
) {
  if (!canEditFormNumber(actor)) throw AppError.forbidden("Only Engineering, a quality manager, or an administrator can change a form number");
  if (!seedFor(formKey)) throw AppError.badRequest("Unknown form");
  const next = formId.trim();
  if (next.length > 40) throw AppError.badRequest("Form number must be 40 characters or fewer");
  await ensureFormTemplates(db);
  const [current] = await db.select().from(controlledFormTemplates).where(eq(controlledFormTemplates.formKey, formKey));
  if (!current) throw AppError.notFound("Form template");
  if (current.formId === next) return current;
  const [updated] = await db.update(controlledFormTemplates).set({ formId: next }).where(eq(controlledFormTemplates.id, current.id)).returning();
  await recordAuditTrail(db, {
    entityType: TEMPLATE_AUDIT,
    entityId: current.id,
    action: "update",
    changes: { event: "form_number", formKey, from: current.formId, to: next },
    performedBy,
  });
  return updated;
}

async function assertRecord(db: Db, formKey: string, recordId: number): Promise<string | null> {
  if (formKey === "frm-par-001") {
    if (recordId !== 1) throw AppError.badRequest("The Pareto chart is a single record");
    return null;
  }
  if (formKey === "frm-msa-001") return null;
  const formType = Object.entries(ISO_TYPE_TO_FORM_KEY).find(([, key]) => key === formKey)?.[0];
  if (!formType) throw AppError.badRequest("This form cannot be filed from here");
  const [record] = await db.select().from(isoQualityForms).where(eq(isoQualityForms.id, recordId));
  if (!record || record.formType !== formType) throw AppError.notFound("Filled form");
  return record.createdAt ? record.createdAt.toISOString().slice(0, 10) : null;
}

export async function getFormFiling(db: Db, formKey: string, recordId: number): Promise<FormFilingView> {
  if (!EDITABLE_FORM_NUMBER_KEYS.has(formKey)) throw AppError.badRequest("This form is not filed from here");
  if (!Number.isInteger(recordId) || recordId <= 0) throw AppError.badRequest("Record is required");
  await ensureFormTemplates(db);
  return presentFiling(db, formKey, recordId, await loadFolders(db));
}

export async function fileFormRecord(db: Db, input: { formKey: string; recordId: number; folderId: number }, performedBy: number | undefined): Promise<FormFilingView> {
  const { formKey, recordId, folderId } = input;
  if (!EDITABLE_FORM_NUMBER_KEYS.has(formKey)) throw AppError.badRequest("This form cannot be filed from here");
  await ensureFormTemplates(db);
  const createdOn = await assertRecord(db, formKey, recordId);
  const [parent] = await db.select().from(documentFolders).where(eq(documentFolders.id, folderId));
  if (!parent) throw AppError.notFound("Folder");

  const [existing] = await db.select().from(formFilings).where(and(eq(formFilings.formKey, formKey), eq(formFilings.recordId, recordId)));
  let filing = existing;
  if (!filing) {
    const [template] = await db.select({ formId: controlledFormTemplates.formId }).from(controlledFormTemplates).where(eq(controlledFormTemplates.formKey, formKey));
    const [created] = await db.insert(formFilings).values({ formKey, recordId, formNumber: template?.formId ?? "" }).returning();
    if (!created) throw new AppError("Failed to file this form", 500);
    filing = created;
  }

  const linkedPath = recordLinkedPath(formKey, recordId);
  if (filing.folderNodeId != null) {
    const [node] = await db.select().from(documentFolders).where(eq(documentFolders.id, filing.folderNodeId));
    if (node) {
      if (node.parentId !== folderId) {
        if (await wouldCreateCycle(db, node.id, folderId)) throw AppError.badRequest("That move would nest a folder inside itself");
        await db.update(documentFolders).set({ parentId: folderId, updatedAt: new Date() }).where(eq(documentFolders.id, node.id));
        await recordAuditTrail(db, {
          entityType: FOLDER_AUDIT,
          entityId: node.id,
          action: "update",
          changes: { event: "moved", name: node.name, fromParentId: node.parentId, toParentId: folderId, formKey, recordId },
          performedBy,
        });
      }
      return presentFiling(db, formKey, recordId, await loadFolders(db));
    }
  }

  const seed = seedFor(formKey);
  const date = createdOn || new Date().toISOString().slice(0, 10);
  const name = filedRecordName("", recordId, date, fileNamePatternFor(seed ?? {}));
  const siblings = await db.select({ id: documentFolders.id }).from(documentFolders).where(eq(documentFolders.parentId, folderId));
  const [created] = await db
    .insert(documentFolders)
    .values({ name, parentId: folderId, sortOrder: siblings.length, linkedPath })
    .returning();
  if (!created) throw new AppError("Failed to file this form", 500);
  await db.update(formFilings).set({ folderNodeId: created.id, updatedAt: new Date() }).where(eq(formFilings.id, filing.id));
  await recordAuditTrail(db, {
    entityType: FOLDER_AUDIT,
    entityId: created.id,
    action: "create",
    changes: { event: "filed", name, parentId: folderId, formKey, recordId, linkedPath },
    performedBy,
  });
  return presentFiling(db, formKey, recordId, await loadFolders(db));
}

export function filingQuery(formKey: unknown, recordId: unknown): { formKey: string; recordId: number } {
  if (typeof formKey !== "string" || !EDITABLE_FORM_NUMBER_KEYS.has(formKey)) {
    throw AppError.badRequest("This form is not filed from here");
  }
  const id = Number(recordId);
  if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest("Record is required");
  return { formKey, recordId: id };
}
