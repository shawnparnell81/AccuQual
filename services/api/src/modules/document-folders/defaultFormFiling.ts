import { and, eq } from "drizzle-orm";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import { formFilings } from "../../drizzle/schema/formFilings.js";
import type { Db } from "../../lib/requestDb.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { FILEABLE_FORM_KEYS } from "./editableForms.js";
import { fileNamePatternFor, FORM_TEMPLATES, type FormTemplateSeed } from "./formFiling.js";
import { ensureSavedFormFolder, isoStamp, RETIRED_FORM_FOLDER_KEYS, savedFillFileName } from "./formFolders.js";
import { fileFormRecord } from "./formRecordFiling.js";
import { ensureFormTemplates } from "./formTemplates.js";
import { canonicalOpenPath } from "./savedFormLinks.js";

const FALLBACK_PATH: Record<string, string> = {
  "/ncr": "ncr",
  "/capa": "capa",
  "/8d": "8d",
  "/document-change-requests": "dcr",
  "/risk": "risk",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Which blank this create belongs to. Exact title, name, or form type wins. A shared table falls back to its general form. */
export function blankFormKeyForCreate(createPath: string, body: Record<string, unknown>): string | null {
  const data = asRecord(body.data);
  const formType = typeof body.formType === "string" ? body.formType : typeof data?.formType === "string" ? data.formType : null;
  const title = typeof body.title === "string" ? body.title : null;
  const name = typeof body.name === "string" ? body.name : null;
  for (const seed of FORM_TEMPLATES) {
    if (seed.start?.createPath !== createPath) continue;
    const start = seed.start.body;
    const startData = asRecord(start.data);
    if (typeof start.formType === "string" && start.formType === formType) return seed.formKey;
    if (typeof startData?.formType === "string" && startData.formType === formType) return seed.formKey;
    if (typeof start.title === "string" && title != null && start.title === title) return seed.formKey;
    if (typeof start.name === "string" && name != null && start.name === name) return seed.formKey;
  }
  return FALLBACK_PATH[createPath] ?? null;
}

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

/** File one new saved copy into that form's default folder. Does not sweep other filings. */
export async function fileBlankCopy(db: Db, createPath: string, created: Record<string, unknown>, performedBy?: number): Promise<void> {
  const recordId = Number(created.id);
  const formKey = blankFormKeyForCreate(createPath, created);
  if (!formKey || RETIRED_FORM_FOLDER_KEYS.has(formKey) || !Number.isInteger(recordId) || recordId < 1) return;
  if (FILEABLE_FORM_KEYS.has(formKey)) {
    await fileFormRecord(db, { formKey, recordId, formFolderKey: formKey }, performedBy);
    return;
  }
  await fileModuleCopy(db, formKey, recordId, created, performedBy);
}
