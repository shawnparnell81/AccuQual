import { and, eq } from "drizzle-orm";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import { formFilings } from "../../drizzle/schema/formFilings.js";
import type { Db } from "../../lib/requestDb.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { FILEABLE_FORM_KEYS } from "./editableForms.js";
import { blankFormKeyForCreate, explicitFileFormKeys, fileNamePatternFor, FORM_TEMPLATES, requiresExplicitFile, type FormTemplateSeed } from "./formFiling.js";
import { ensureSavedFormFolder, isoStamp, RETIRED_FORM_FOLDER_KEYS, savedFillFileName } from "./formFolders.js";
import { fileFormRecord, snapshotFormNumber } from "./formRecordFiling.js";
import { ensureFormTemplates } from "./formTemplates.js";
import { canonicalOpenPath } from "./savedFormLinks.js";

function textField(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

/** Same name the folder list shows, so search can find the file that was just saved. */
function moduleFileName(formKey: string, seed: FormTemplateSeed | undefined, recordId: number, created: Record<string, unknown>): string {
  const createPath = seed?.start?.createPath ?? "";
  let label: string | null = null;
  let number: string | null = "";
  if (formKey === "dcr") {
    label = textField(created, "documentProcessName");
    number = textField(created, "formNo");
  } else if (createPath === "/qms-forms") {
    number = textField(created, "formNo");
  } else if (createPath === "/equipment") {
    label = textField(created, "name");
  } else if (createPath === "/training") {
    label = textField(created, "title");
  } else if (createPath === "/audits") {
    label = textField(created, "name");
    number = textField(created, "recordNumber");
  } else if (createPath === "/capa" || createPath === "/8d") {
    number = textField(created, "recordNumber");
  } else {
    label = textField(created, "title") ?? textField(created, "name");
    number = textField(created, "recordNumber");
  }
  const updatedAt = created.updatedAt instanceof Date || typeof created.updatedAt === "string" ? created.updatedAt : null;
  const createdAt = created.createdAt instanceof Date || typeof created.createdAt === "string" ? created.createdAt : null;
  return savedFillFileName({
    formId: seed?.formId ?? "",
    title: seed?.title ?? "Form",
    recordId,
    savedAt: updatedAt || createdAt ? isoStamp(updatedAt, createdAt) : new Date().toISOString(),
    pattern: fileNamePatternFor(seed ?? {}),
    recordLabel: label,
    number,
  });
}

async function fileModuleCopy(db: Db, formKey: string, recordId: number, created: Record<string, unknown>, performedBy?: number): Promise<void> {
  await ensureFormTemplates(db, performedBy);
  const parentId = await ensureSavedFormFolder(db, formKey, performedBy, formKey);
  const [existing] = await db.select().from(formFilings).where(and(eq(formFilings.formKey, formKey), eq(formFilings.recordId, recordId)));
  if (existing?.folderNodeId != null) return;
  const seed = FORM_TEMPLATES.find((item) => item.formKey === formKey);
  const linkedPath = canonicalOpenPath(formKey, recordId);
  const name = moduleFileName(formKey, seed, recordId, created);
  const siblings = await db.select({ id: documentFolders.id }).from(documentFolders).where(eq(documentFolders.parentId, parentId));
  const [node] = await db
    .insert(documentFolders)
    .values({ name, parentId, sortOrder: siblings.length, linkedPath })
    .returning();
  if (!node) return;
  if (existing) {
    await db.update(formFilings).set({ folderNodeId: node.id, updatedAt: new Date() }).where(eq(formFilings.id, existing.id));
  } else {
    await db.insert(formFilings).values({ formKey, recordId, formNumber: seed?.formId ?? "", folderNodeId: node.id });
  }
  await recordAuditTrail(db, {
    entityType: "DocumentFolder",
    entityId: node.id,
    action: "create",
    changes: { event: "filed", name, parentId, formKey, recordId, linkedPath },
    performedBy,
  });
}

/** Save as for a QMS copy. It goes in that form's folder, not an arbitrary Documents folder. */
export async function fileExplicitModuleCopy(db: Db, formKey: string, recordId: number, performedBy?: number): Promise<void> {
  if (!explicitFileFormKeys().has(formKey) || FILEABLE_FORM_KEYS.has(formKey)) return;
  await fileModuleCopy(db, formKey, recordId, { id: recordId }, performedBy);
}

/** A Report No. edit is not a Save. Any other field is. */
export function patchIsNumberOnly(patch: Record<string, unknown>): boolean {
  const keys = Object.keys(patch).filter((key) => key !== "updatedAt");
  return keys.length === 0 || keys.every((key) => key === "recordNumber" || key === "formNo" || key === "scarNumber");
}

/** The first Save puts the copy in its folder. A later Save leaves that filing alone. */
export async function fileOnFirstSave(
  db: Db,
  createPath: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  patch: Record<string, unknown>,
  performedBy?: number,
): Promise<void> {
  if (requiresExplicitFile(createPath) || patchIsNumberOnly(patch)) return;
  // The first save can rename the blank. The folder is the one that was opened, not the new name.
  const started = before as Record<string, unknown>;
  const formKey = blankFormKeyForCreate(createPath, { ...after, ...started }) ?? blankFormKeyForCreate(createPath, after);
  const recordId = Number(after.id);
  // A number-only edit can stamp updated_at without filing. The next real save still files once.
  if (before.updatedAt != null && formKey && Number.isInteger(recordId)) {
    const [existing] = await db
      .select({ folderNodeId: formFilings.folderNodeId })
      .from(formFilings)
      .where(and(eq(formFilings.formKey, formKey), eq(formFilings.recordId, recordId)));
    if (existing?.folderNodeId != null) return;
  }
  await fileBlankCopy(db, createPath, after, performedBy, "save", formKey);
}

/**
 * Starting a blank remembers the form number and does not put a copy in a folder.
 * The first Save files it. Save as files it into the folder the user picks.
 */
export async function fileBlankCopy(
  db: Db,
  createPath: string,
  created: Record<string, unknown>,
  performedBy?: number,
  when: "start" | "save" = "start",
  knownKey?: string | null,
): Promise<void> {
  const recordId = Number(created.id);
  const formKey = knownKey ?? blankFormKeyForCreate(createPath, created);
  if (!formKey || RETIRED_FORM_FOLDER_KEYS.has(formKey) || !Number.isInteger(recordId) || recordId < 1) return;
  if (when === "start") {
    if (FILEABLE_FORM_KEYS.has(formKey)) await snapshotFormNumber(db, formKey, recordId);
    return;
  }
  if (FILEABLE_FORM_KEYS.has(formKey)) {
    await fileFormRecord(db, { formKey, recordId, formFolderKey: formKey }, performedBy);
    return;
  }
  await fileModuleCopy(db, formKey, recordId, created, performedBy);
}
