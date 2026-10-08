import { and, desc, eq } from "drizzle-orm";
import { company } from "../../drizzle/schema/company.js";
import { builtFormFills, builtFormRevisions, builtForms } from "../../drizzle/schema/builtForms.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import { roles } from "../../drizzle/schema/roles.js";
import { users } from "../../drizzle/schema/users.js";
import type { Db } from "../../lib/requestDb.js";
import { getUserAccessLevel, type AccessLevel } from "../../middleware/departmentAccess.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { BLANK_FORMS_FOLDER } from "../document-folders/formFiling.js";
import { folderLocationLabel } from "../document-folders/mainIsoFolders.js";
import { FORM_BUILDER_PERMISSION } from "../roles/roleAccess.js";
import { formatSignatureStamp } from "../signatures/signaturePin.js";
import { verifySignaturePin } from "../signatures/signaturePin.service.js";
import { formatUserLabel } from "../users/userDisplay.js";
import { canEditFormBuilder, canFillBuiltForm, canReadFormBuilder, type FormBuilderAccessInput, type ModuleLevel } from "./access.js";
import { docxFromHtml, htmlFromDocx, sanitizeDocumentHtml } from "./docx.js";
import { openFillCopy, saveFillAnswers } from "./fillCopy.js";
import { decideStructureSave, type SaveMode } from "./revision.js";

const AUDIT = "BuiltForm";
const CERTIFY = "I certify that this record is accurate and that I approve this sign-off.";
const TEMPLATE_PREFIX = "/form-builder/template/";
const FILL_PREFIX = "/form-builder/fills/";
const MAX_STRUCTURE = 1_500_000;
const MAX_PHOTO = 1_200_000;

export type FormKind = "grid" | "document" | "fields";

const KINDS = new Set<FormKind>(["grid", "document", "fields"]);

interface Actor {
  id: number;
  roleName: string | null;
  department: string | null;
}

function asLevel(value: AccessLevel): ModuleLevel {
  return value;
}

export async function formBuilderAccess(db: Db, actor: Actor): Promise<FormBuilderAccessInput & { documentsLevel: ModuleLevel }> {
  const [moduleLevel, documentsLevel] = await Promise.all([
    getUserAccessLevel(db, actor, "form_builder"),
    getUserAccessLevel(db, actor, "documents"),
  ]);
  let roleHasPermission = false;
  if (actor.roleName) {
    const [role] = await db.select({ permissions: roles.permissions }).from(roles).where(eq(roles.name, actor.roleName));
    roleHasPermission = (role?.permissions ?? []).includes(FORM_BUILDER_PERMISSION);
  }
  return { roleName: actor.roleName, roleHasPermission, moduleLevel: asLevel(moduleLevel), documentsLevel: asLevel(documentsLevel) };
}

async function requireEditor(db: Db, actor: Actor) {
  const access = await formBuilderAccess(db, actor);
  if (!canEditFormBuilder(access)) throw AppError.forbidden("Form Builder is not turned on for you. An administrator can turn it on under Users & Roles or Roles & Permissions.");
  return access;
}

async function requireReader(db: Db, actor: Actor) {
  const access = await formBuilderAccess(db, actor);
  if (!canReadFormBuilder(access)) throw AppError.forbidden("Form Builder is not turned on for you. An administrator can turn it on under Users & Roles or Roles & Permissions.");
  return access;
}

async function requireFiller(db: Db, actor: Actor) {
  const access = await formBuilderAccess(db, actor);
  if (!canFillBuiltForm(access)) throw AppError.forbidden("You can view this form once Documents is turned on for you.");
  return access;
}

async function who(db: Db, actor: Actor): Promise<{ label: string; when: string }> {
  const [person] = await db.select({ name: users.name, email: users.email, isActive: users.isActive }).from(users).where(eq(users.id, actor.id));
  const [profile] = await db.select({ profile: company.profile }).from(company).limit(1);
  const timeZone = profile?.profile?.timezone || "UTC";
  const when = new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date());
  return { label: formatUserLabel(person ? { ...person, isActive: person.isActive ?? true } : undefined, actor.id), when };
}

function kindLabel(kind: string): string {
  if (kind === "grid") return "grid form";
  if (kind === "document") return "Word-style document";
  return "form";
}

function assertKind(kind: string): FormKind {
  if (!KINDS.has(kind as FormKind)) throw AppError.badRequest("Choose a grid, a document, or a regular form.");
  return kind as FormKind;
}

function assertStructure(kind: FormKind, structure: unknown) {
  if (!structure || typeof structure !== "object" || Array.isArray(structure)) throw AppError.badRequest("The form structure is missing.");
  const record = structure as { kind?: unknown; html?: unknown };
  if (record.kind !== kind) throw AppError.badRequest("The form structure does not match this form.");
  if (kind === "document" && typeof record.html === "string") record.html = sanitizeDocumentHtml(record.html);
  const text = JSON.stringify(structure);
  if (text.length > MAX_STRUCTURE) throw AppError.badRequest("That form is too large to save.");
}

function blankStructure(kind: FormKind): unknown {
  if (kind === "grid") {
    return {
      kind: "grid",
      sheets: [
        {
          name: "Sheet1",
          colWidths: Array.from({ length: 8 }, () => 96),
          rowHeights: Array.from({ length: 20 }, () => 22),
          cells: Array.from({ length: 20 }, () => Array.from({ length: 8 }, () => ({ value: "", locked: false, rowSpan: 1, colSpan: 1, style: {} }))),
        },
      ],
    };
  }
  if (kind === "document") {
    return { kind: "document", html: "<h1></h1><p></p>", showLogo: true, showPageNumbers: true };
  }
  return { kind: "fields", sections: [{ id: "general", title: "General" }], fields: [] };
}

function publicForm(row: typeof builtForms.$inferSelect) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    formNumber: row.formNumber,
    revision: row.revision,
    status: row.status,
    structure: row.structure,
    publishedStructure: row.publishedStructure,
    folderId: row.folderId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
  };
}

export async function listBuiltForms(db: Db, actor: Actor) {
  await requireReader(db, actor);
  const rows = await db.select().from(builtForms).orderBy(desc(builtForms.updatedAt));
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    formNumber: row.formNumber,
    revision: row.revision,
    status: row.status,
    folderId: row.folderId,
    updatedAt: row.updatedAt,
  }));
}

export async function createBuiltForm(db: Db, actor: Actor, input: { kind: string; title?: string }) {
  await requireEditor(db, actor);
  const kind = assertKind(input.kind);
  const title = input.title?.trim() || "Untitled form";
  const structure = blankStructure(kind);
  const [created] = await db
    .insert(builtForms)
    .values({ kind, title, formNumber: null, revision: "A", status: "draft", structure, createdBy: actor.id, updatedBy: actor.id })
    .returning();
  if (!created) throw new Error("Could not create the form");
  const person = await who(db, actor);
  await recordAuditTrail(db, {
    entityType: AUDIT,
    entityId: created.id,
    action: "create",
    changes: {
      summary: `${person.label} created the ${kindLabel(kind)} "${created.title}" on ${person.when}. The form number is blank until someone sets it. Revision ${created.revision}.`,
      kind,
      title: created.title,
      revision: created.revision,
    },
    performedBy: actor.id,
  });
  return publicForm(created);
}

export async function getBuiltForm(db: Db, actor: Actor, id: number) {
  await requireReader(db, actor);
  const [row] = await db.select().from(builtForms).where(eq(builtForms.id, id));
  if (!row) throw AppError.notFound("Form");
  return publicForm(row);
}

export async function listRevisions(db: Db, actor: Actor, id: number) {
  await requireReader(db, actor);
  const [row] = await db.select({ id: builtForms.id }).from(builtForms).where(eq(builtForms.id, id));
  if (!row) throw AppError.notFound("Form");
  return db.select().from(builtFormRevisions).where(eq(builtFormRevisions.formId, id)).orderBy(desc(builtFormRevisions.createdAt));
}

export async function saveBuiltForm(
  db: Db,
  actor: Actor,
  id: number,
  input: { title?: string; formNumber?: string | null; structure?: unknown; mode?: SaveMode },
) {
  await requireEditor(db, actor);
  const [current] = await db.select().from(builtForms).where(eq(builtForms.id, id));
  if (!current) throw AppError.notFound("Form");
  const mode: SaveMode = input.mode === "publish" ? "publish" : input.mode === "save" ? "save" : "autosave";
  const kind = assertKind(current.kind);
  const structure = input.structure === undefined ? current.structure : input.structure;
  assertStructure(kind, structure);
  const title = input.title === undefined ? current.title : input.title.trim() || current.title;
  const formNumber = input.formNumber === undefined ? current.formNumber : input.formNumber?.trim() || null;
  const decision = decideStructureSave({
    mode,
    status: current.status === "published" ? "published" : "draft",
    revision: current.revision,
    publishedStructure: current.publishedStructure,
    nextStructure: structure,
  });
  const [updated] = await db
    .update(builtForms)
    .set({
      title,
      formNumber,
      structure,
      revision: decision.revision,
      status: decision.status,
      publishedStructure: decision.publishedStructure,
      updatedBy: actor.id,
      updatedAt: new Date(),
    })
    .where(eq(builtForms.id, id))
    .returning();
  if (!updated) throw AppError.notFound("Form");
  const person = await who(db, actor);
  if (decision.recordHistory) {
    const summary = decision.bumped
      ? `${person.label} edited the structure of "${title}" and saved revision ${decision.revision} on ${person.when}. Filling a copy does not change this revision.`
      : `${person.label} saved the structure of "${title}" on ${person.when}. Revision stays ${decision.revision}.`;
    await db.insert(builtFormRevisions).values({
      formId: id,
      revision: decision.revision,
      structure,
      summary,
      savedBy: actor.id,
    });
    await recordAuditTrail(db, {
      entityType: AUDIT,
      entityId: id,
      action: "update",
      changes: { summary, revision: decision.revision, title },
      performedBy: actor.id,
    });
  } else if (mode === "save" && (title !== current.title || formNumber !== current.formNumber)) {
    const summary = `${person.label} updated the name of "${title}" on ${person.when}. Revision stays ${decision.revision} because the structure did not change.`;
    await recordAuditTrail(db, {
      entityType: AUDIT,
      entityId: id,
      action: "update",
      changes: { summary, revision: decision.revision, title, formNumber },
      performedBy: actor.id,
    });
  }
  if (formNumber !== current.formNumber || title !== current.title) await renameTemplateLeaf(db, updated);
  return publicForm(updated);
}

async function foldersOf(db: Db) {
  return db.select().from(documentFolders);
}

function underBlank(folders: { id: number; parentId: number | null; name: string }[], folderId: number): boolean {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let current = byId.get(folderId);
  const seen = new Set<number>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.name === BLANK_FORMS_FOLDER) return true;
    current = current.parentId == null ? undefined : byId.get(current.parentId);
  }
  return false;
}

async function renameTemplateLeaf(db: Db, form: typeof builtForms.$inferSelect) {
  const path = `${TEMPLATE_PREFIX}${form.id}`;
  const [leaf] = await db.select().from(documentFolders).where(eq(documentFolders.linkedPath, path));
  if (!leaf) return;
  const name = form.formNumber?.trim() ? `${form.formNumber.trim()} ${form.title}` : form.title;
  if (leaf.name === name) return;
  await db.update(documentFolders).set({ name, updatedAt: new Date() }).where(eq(documentFolders.id, leaf.id));
}

export async function publishBuiltForm(db: Db, actor: Actor, id: number, folderId: number, structure?: unknown) {
  await requireEditor(db, actor);
  const [current] = await db.select().from(builtForms).where(eq(builtForms.id, id));
  if (!current) throw AppError.notFound("Form");
  const folders = await foldersOf(db);
  const chosen = folders.find((folder) => folder.id === folderId);
  if (!chosen) throw AppError.badRequest("Choose a folder under Blank Forms Templates.");
  if (!underBlank(folders, chosen.id)) throw AppError.badRequest("Publish the blank into Blank Forms Templates, or a folder under it.");
  const parentId = chosen.linkedPath ? chosen.parentId : chosen.id;
  if (parentId == null) throw AppError.badRequest("Choose a folder under Blank Forms Templates.");
  const saved = await saveBuiltForm(db, actor, id, { structure: structure ?? current.structure, mode: "publish" });
  const [form] = await db.select().from(builtForms).where(eq(builtForms.id, id));
  if (!form) throw AppError.notFound("Form");
  const path = `${TEMPLATE_PREFIX}${form.id}`;
  const name = form.formNumber?.trim() ? `${form.formNumber.trim()} ${form.title}` : form.title;
  const existing = folders.find((folder) => folder.linkedPath === path);
  let leafId = existing?.id;
  if (existing) {
    await db.update(documentFolders).set({ name, parentId, updatedAt: new Date() }).where(eq(documentFolders.id, existing.id));
  } else {
    const siblings = folders.filter((folder) => folder.parentId === parentId);
    const [created] = await db
      .insert(documentFolders)
      .values({ name, parentId, sortOrder: siblings.length, linkedPath: path })
      .returning();
    leafId = created?.id;
  }
  await db.update(builtForms).set({ folderId: parentId, publishedAt: new Date(), status: "published" }).where(eq(builtForms.id, id));
  const person = await who(db, actor);
  const place = folderLocationLabel(folders, parentId);
  const numberLine = form.formNumber?.trim() ? `Form number ${form.formNumber.trim()}.` : "The form number is still blank.";
  const summary = `${person.label} published "${form.title}" revision ${form.revision} into ${place} on ${person.when}. ${numberLine} Opening that blank starts a fresh copy.`;
  await recordAuditTrail(db, {
    entityType: AUDIT,
    entityId: id,
    action: "status_change",
    changes: { summary, revision: form.revision, folderId: parentId, folder: place },
    performedBy: actor.id,
  });
  return { ...saved, status: "published" as const, folderId: parentId, leafId: leafId ?? null };
}

export async function deleteBuiltForm(db: Db, actor: Actor, id: number) {
  await requireEditor(db, actor);
  const [current] = await db.select().from(builtForms).where(eq(builtForms.id, id));
  if (!current) throw AppError.notFound("Form");
  const person = await who(db, actor);
  const summary = `${person.label} deleted the ${kindLabel(current.kind)} "${current.title}" (revision ${current.revision}) on ${person.when}.`;
  await recordAuditTrail(db, {
    entityType: AUDIT,
    entityId: id,
    action: "delete",
    changes: { summary, title: current.title, revision: current.revision },
    performedBy: actor.id,
  });
  const path = `${TEMPLATE_PREFIX}${id}`;
  await db.delete(documentFolders).where(eq(documentFolders.linkedPath, path));
  await db.delete(builtFormFills).where(eq(builtFormFills.formId, id));
  await db.delete(builtForms).where(eq(builtForms.id, id));
}

export async function openBuiltFill(db: Db, actor: Actor, formId: number) {
  await requireFiller(db, actor);
  const [form] = await db.select().from(builtForms).where(eq(builtForms.id, formId));
  if (!form) throw AppError.notFound("Form");
  if (form.status !== "published" || form.publishedStructure == null) throw AppError.badRequest("Publish the form before filling a copy.");
  const template = {
    id: form.id,
    title: form.title,
    formNumber: form.formNumber,
    revision: form.revision,
    structure: form.publishedStructure,
  };
  const copy = openFillCopy(template);
  if (JSON.stringify(template) !== JSON.stringify({ ...template, structure: form.publishedStructure })) {
    throw new Error("Opening a copy changed the template");
  }
  const [created] = await db
    .insert(builtFormFills)
    .values({
      formId: form.id,
      templateRevision: copy.templateRevision,
      templateFormNumber: copy.templateFormNumber,
      structure: copy.structure,
      title: form.title,
      answers: copy.answers,
      createdBy: actor.id,
      updatedBy: actor.id,
    })
    .returning();
  if (!created) throw new Error("Could not open a copy");
  const [after] = await db.select().from(builtForms).where(eq(builtForms.id, formId));
  if (!after || after.revision !== form.revision || JSON.stringify(after.publishedStructure) !== JSON.stringify(form.publishedStructure) || after.updatedAt?.getTime() !== form.updatedAt?.getTime()) {
    throw new Error("Opening a copy changed the template");
  }
  return created;
}

export async function getBuiltFill(db: Db, actor: Actor, id: number) {
  await requireFiller(db, actor);
  const [row] = await db.select().from(builtFormFills).where(eq(builtFormFills.id, id));
  if (!row) throw AppError.notFound("Filled form");
  return row;
}

function mergeAnswers(previous: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...incoming };
  for (const [key, value] of Object.entries(previous)) {
    if (value && typeof value === "object" && (value as { stamped?: boolean }).stamped === true) next[key] = value;
  }
  for (const value of Object.values(next)) {
    if (typeof value === "string" && value.startsWith("data:") && value.length > MAX_PHOTO) {
      throw AppError.badRequest("That photo is too large. Use an image under 1 MB.");
    }
  }
  return next;
}

export async function saveBuiltFill(db: Db, actor: Actor, id: number, input: { title?: string; answers?: Record<string, unknown> }) {
  await requireFiller(db, actor);
  const [current] = await db.select().from(builtFormFills).where(eq(builtFormFills.id, id));
  if (!current) throw AppError.notFound("Filled form");
  const [template] = await db.select().from(builtForms).where(eq(builtForms.id, current.formId));
  const previousAnswers = (current.answers ?? {}) as Record<string, unknown>;
  const answers = input.answers ? mergeAnswers(previousAnswers, input.answers) : previousAnswers;
  const kept = saveFillAnswers(
    {
      templateId: current.formId,
      templateRevision: current.templateRevision,
      templateFormNumber: current.templateFormNumber,
      structure: current.structure,
      answers: previousAnswers,
    },
    answers,
  );
  const [updated] = await db
    .update(builtFormFills)
    .set({
      title: input.title?.trim() || current.title,
      answers: kept.answers,
      templateRevision: current.templateRevision,
      structure: current.structure,
      updatedBy: actor.id,
      updatedAt: new Date(),
    })
    .where(eq(builtFormFills.id, id))
    .returning();
  if (template) {
    const [after] = await db.select().from(builtForms).where(eq(builtForms.id, template.id));
    if (!after || after.revision !== template.revision || JSON.stringify(after.structure) !== JSON.stringify(template.structure)) {
      throw new Error("Saving a filled copy changed the template");
    }
  }
  return updated;
}

export async function fileBuiltFill(db: Db, actor: Actor, id: number, folderId: number) {
  await requireFiller(db, actor);
  const [fill] = await db.select().from(builtFormFills).where(eq(builtFormFills.id, id));
  if (!fill) throw AppError.notFound("Filled form");
  const folders = await foldersOf(db);
  const chosen = folders.find((folder) => folder.id === folderId);
  if (!chosen) throw AppError.badRequest("Choose a Documents folder.");
  if (underBlank(folders, chosen.id)) throw AppError.badRequest("A filled copy is not saved into Blank Forms Templates. Choose another Documents folder.");
  const parentId = chosen.linkedPath ? chosen.parentId : chosen.id;
  if (parentId == null) throw AppError.badRequest("Choose a Documents folder.");
  const path = `${FILL_PREFIX}${fill.id}`;
  const existing = folders.find((folder) => folder.linkedPath === path);
  if (existing) {
    await db.update(documentFolders).set({ name: fill.title, parentId, updatedAt: new Date() }).where(eq(documentFolders.id, existing.id));
  } else {
    const siblings = folders.filter((folder) => folder.parentId === parentId);
    await db.insert(documentFolders).values({ name: fill.title, parentId, sortOrder: siblings.length, linkedPath: path });
  }
  const [updated] = await db.update(builtFormFills).set({ folderId: parentId, updatedAt: new Date() }).where(eq(builtFormFills.id, id)).returning();
  return { fill: updated, folder: folderLocationLabel(folders, parentId) };
}

export async function signBuiltFill(db: Db, actor: Actor, id: number, input: { fieldId: string; pin: string }) {
  await requireFiller(db, actor);
  const fieldId = input.fieldId.trim();
  if (!fieldId) throw AppError.badRequest("Choose the signature to stamp.");
  const verified = await verifySignaturePin(actor.id, input.pin);
  const [fill] = await db.select().from(builtFormFills).where(eq(builtFormFills.id, id));
  if (!fill) throw AppError.notFound("Filled form");
  const [profile] = await db.select({ profile: company.profile }).from(company).limit(1);
  const stamp = formatSignatureStamp(verified.displayName, new Date(), profile?.profile?.timezone || "UTC");
  const text = `${stamp}. ${CERTIFY}`;
  const answers = { ...((fill.answers ?? {}) as Record<string, unknown>), [fieldId]: { stamped: true, text } };
  const [updated] = await db.update(builtFormFills).set({ answers, updatedBy: actor.id, updatedAt: new Date() }).where(and(eq(builtFormFills.id, id))).returning();
  return updated;
}

export async function importDocx(db: Db, actor: Actor, file: Buffer) {
  await requireEditor(db, actor);
  try {
    return { html: htmlFromDocx(file) };
  } catch {
    throw AppError.badRequest("Couldn't read that Word file. A .docx with headings and paragraphs can be imported. Older .doc files cannot.");
  }
}

export async function exportDocx(db: Db, actor: Actor, id: number) {
  await requireReader(db, actor);
  const [form] = await db.select().from(builtForms).where(eq(builtForms.id, id));
  if (!form) throw AppError.notFound("Form");
  if (form.kind !== "document") throw AppError.badRequest("Only a Word-style document can be downloaded as .docx.");
  const structure = form.structure as { html?: string };
  const html = typeof structure.html === "string" ? structure.html : "";
  const bytes = await docxFromHtml(html, { docId: form.formNumber, rev: form.revision });
  return { filename: `${form.title || "document"}.docx`, bytes };
}
