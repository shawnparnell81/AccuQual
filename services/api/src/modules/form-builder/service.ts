import { and, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { company } from "../../drizzle/schema/company.js";
import { builtFormFills, builtFormRevisions, builtForms } from "../../drizzle/schema/builtForms.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import { roles } from "../../drizzle/schema/roles.js";
import { users } from "../../drizzle/schema/users.js";
import type { Db } from "../../lib/requestDb.js";
import { getUserAccessLevel, type AccessLevel } from "../../middleware/departmentAccess.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { BUILT_FILL_NUMBER } from "../records/recordNumberSpecs.js";
import { applyRecordNumber, changesWithNumberEdit } from "../records/userRecordNumber.js";
import { stampRecordSite } from "../sites/recordSite.js";
import { BLANK_FORMS_FOLDER } from "../document-folders/formFiling.js";
import { folderLocationLabel, folderPathParts, joinFolderPath } from "../document-folders/mainIsoFolders.js";
import { FORM_BUILDER_APPROVE_PERMISSION, FORM_BUILDER_PERMISSION } from "../roles/roleAccess.js";
import { roleHasPermission } from "../roles/rolePermissions.js";
import { formatSignatureStamp } from "../signatures/signaturePin.js";
import { verifySignaturePin } from "../signatures/signaturePin.service.js";
import { formatUserLabel } from "../users/userDisplay.js";
import { canEditFormBuilder, canFillBuiltForm, canReadFormBuilder, type FormBuilderAccessInput, type ModuleLevel } from "./access.js";
import { editActionFrom, recordEditSession, scalarEdits } from "../forms/formEditAudit.js";
import { sanitizeBandHtml } from "./bandSanitize.js";
import { cleanBand, type DocumentBand } from "./docxBands.js";
import { docxFromHtml, htmlFromDocx, sanitizeDocumentHtml } from "./docx.js";
import { openFillCopy, saveFillAnswers } from "./fillCopy.js";
import { gridCellKinds, recomputeGridAnswers } from "./gridFill.js";
import { renderGridPdf } from "./gridPdf.js";
import { validateGridStructure } from "./gridStructure.js";
import { decideStructureSave, descriptionOf, type SaveMode } from "./revision.js";

const AUDIT = "BuiltForm";
const CERTIFY = "I certify that this record is accurate and that I approve this sign-off.";
const TEMPLATE_PREFIX = "/form-builder/template/";
const FILL_PREFIX = "/form-builder/fills/";
const MAX_STRUCTURE = 1_500_000;
const MAX_PHOTO = 1_200_000;
/** Shown to the approver after a revision goes live. The list is not updated for them. */
export const MASTER_LIST_NOTICE = "Update the Master Document List with the new revision.";

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

async function requireApprover(db: Db, actor: Actor) {
  if (!(await roleHasPermission(db, actor.roleName, FORM_BUILDER_APPROVE_PERMISSION))) {
    throw AppError.forbidden("Approving a form revision is not turned on for you. An administrator can turn it on under Roles & Permissions.");
  }
}

async function requireFiller(db: Db, actor: Actor) {
  const access = await formBuilderAccess(db, actor);
  if (!canFillBuiltForm(access)) throw AppError.forbidden("You can view this form once Documents is turned on for you.");
  return access;
}

/**
 * Changing a filled copy (typing, Save, signing, filing, Edit) takes the same access as Edit on every other record:
 * edit on Documents or on Form Builder, both assigned by an administrator. Viewing a copy only needs Documents.
 */
async function requireFillEditor(db: Db, actor: Actor, verb = "change") {
  const access = await formBuilderAccess(db, actor);
  if (access.documentsLevel !== "edit" && !canEditFormBuilder(access)) {
    throw AppError.forbidden(`You don't have permission to ${verb} this form. An administrator can give you edit access to Documents under Roles & Permissions.`);
  }
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

/** The description a person typed, as the end of a sentence. */
function endSentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function assertStructure(kind: FormKind, structure: unknown) {
  if (!structure || typeof structure !== "object" || Array.isArray(structure)) throw AppError.badRequest("The form structure is missing.");
  const record = structure as { kind?: unknown; html?: unknown };
  if (record.kind !== kind) throw AppError.badRequest("The form structure does not match this form.");
  if (kind === "grid") validateGridStructure(structure);
  if (kind === "document") {
    if (typeof record.html === "string") record.html = sanitizeDocumentHtml(record.html);
    const document = record as { header?: unknown; footer?: unknown };
    document.header = cleanBand(document.header, sanitizeBandHtml);
    document.footer = cleanBand(document.footer, sanitizeBandHtml);
  }
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
    return { kind: "document", html: "<h1></h1><p></p>", showLogo: true, showPageNumbers: true, header: null, footer: null };
  }
  return { kind: "fields", sections: [{ id: "general", title: "General" }], fields: [] };
}

type Pending = { id: number; revision: string } | null;

async function pendingRevisionFor(db: Db, formId: number): Promise<Pending> {
  const [row] = await db
    .select({ id: builtFormRevisions.id, revision: builtFormRevisions.revision })
    .from(builtFormRevisions)
    .where(and(eq(builtFormRevisions.formId, formId), eq(builtFormRevisions.status, "pending")));
  return row ?? null;
}

function publicForm(row: typeof builtForms.$inferSelect, pending: Pending = null) {
  return {
    pendingRevision: pending?.revision ?? null,
    pendingRevisionId: pending?.id ?? null,
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
  const pendingRows = rows.length
    ? await db
        .select({ formId: builtFormRevisions.formId, revision: builtFormRevisions.revision })
        .from(builtFormRevisions)
        .where(and(inArray(builtFormRevisions.formId, rows.map((row) => row.id)), eq(builtFormRevisions.status, "pending")))
    : [];
  const pendingByForm = new Map(pendingRows.map((row) => [row.formId, row.revision]));
  return rows.map((row) => ({
    pendingRevision: pendingByForm.get(row.id) ?? null,
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
  const canApprove = await roleHasPermission(db, actor.roleName, FORM_BUILDER_APPROVE_PERMISSION);
  return { ...publicForm(row, await pendingRevisionFor(db, id)), canApprove };
}

export async function listRevisions(db: Db, actor: Actor, id: number) {
  await requireReader(db, actor);
  const [row] = await db.select({ id: builtForms.id }).from(builtForms).where(eq(builtForms.id, id));
  if (!row) throw AppError.notFound("Form");
  const approver = alias(users, "approver");
  const rows = await db
    .select({
      id: builtFormRevisions.id,
      revision: builtFormRevisions.revision,
      summary: builtFormRevisions.summary,
      status: builtFormRevisions.status,
      savedBy: builtFormRevisions.savedBy,
      createdAt: builtFormRevisions.createdAt,
      approvedBy: builtFormRevisions.approvedBy,
      approvedAt: builtFormRevisions.approvedAt,
      decisionNote: builtFormRevisions.decisionNote,
      approvalSignature: builtFormRevisions.approvalSignature,
      name: users.name,
      email: users.email,
      isActive: users.isActive,
      approverName: approver.name,
      approverEmail: approver.email,
      approverActive: approver.isActive,
    })
    .from(builtFormRevisions)
    .leftJoin(users, eq(users.id, builtFormRevisions.savedBy))
    .leftJoin(approver, eq(approver.id, builtFormRevisions.approvedBy))
    .where(eq(builtFormRevisions.formId, id))
    .orderBy(desc(builtFormRevisions.createdAt), desc(builtFormRevisions.id));
  return rows.map((row) => ({
    id: row.id,
    revision: row.revision,
    summary: row.summary,
    description: descriptionOf(row.summary),
    savedBy: row.savedBy,
    savedByName: row.savedBy == null ? null : formatUserLabel(row.email == null ? undefined : { name: row.name, email: row.email, isActive: row.isActive ?? true }, row.savedBy),
    createdAt: row.createdAt,
    status: row.status,
    approvedBy: row.approvedBy,
    approvedByName:
      row.approvedBy == null ? null : formatUserLabel(row.approverEmail == null ? undefined : { name: row.approverName, email: row.approverEmail, isActive: row.approverActive ?? true }, row.approvedBy),
    approvedAt: row.approvedAt,
    decisionNote: row.decisionNote,
    approvalSignature: row.approvalSignature,
  }));
}

export async function saveBuiltForm(
  db: Db,
  actor: Actor,
  id: number,
  input: { title?: string; formNumber?: string | null; structure?: unknown; mode?: SaveMode; newRevision?: unknown; changeDescription?: unknown },
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
    newRevision: input.newRevision,
    changeDescription: input.changeDescription,
  });
  if (decision.submit) {
    const waiting = await pendingRevisionFor(db, id);
    if (waiting) {
      throw new AppError(`REV ${waiting.revision} is waiting for approval. Approve or reject it before submitting another revision.`, 409);
    }
  }
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
  const name = formNumber ? `${formNumber} ${title}` : title;
  if (decision.submit && decision.submitRevision) {
    // The structure goes to approval. Fillers keep opening the last approved version until someone approves it.
    const summary = decision.change
      ? `${person.label} changed ${name} from REV ${decision.change.from} to REV ${decision.change.to} on ${person.when}: ${endSentence(decision.change.description)}`
      : `${person.label} submitted ${name} REV ${decision.submitRevision} for approval on ${person.when}.`;
    await db.insert(builtFormRevisions).values({
      formId: id,
      revision: decision.submitRevision,
      structure,
      summary,
      savedBy: actor.id,
      status: "pending",
    });
    await recordAuditTrail(db, {
      entityType: AUDIT,
      entityId: id,
      action: "update",
      changes: decision.change
        ? { summary, revision: decision.submitRevision, previousRevision: decision.change.from, description: decision.change.description, title, status: "pending" }
        : { summary, revision: decision.submitRevision, title, status: "pending" },
      performedBy: actor.id,
    });
  } else if (decision.recordHistory) {
    const summary =
      decision.revision !== current.revision
        ? `${person.label} set the revision of "${title}" to ${decision.revision} on ${person.when}.`
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
  return publicForm(updated, await pendingRevisionFor(db, id));
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

export async function publishBuiltForm(
  db: Db,
  actor: Actor,
  id: number,
  folderId: number,
  structure?: unknown,
  revision?: { newRevision?: unknown; changeDescription?: unknown },
) {
  await requireEditor(db, actor);
  const [current] = await db.select().from(builtForms).where(eq(builtForms.id, id));
  if (!current) throw AppError.notFound("Form");
  const folders = await foldersOf(db);
  const chosen = folders.find((folder) => folder.id === folderId);
  if (!chosen) throw AppError.badRequest("Choose a folder under Blank Forms Templates.");
  if (!underBlank(folders, chosen.id)) throw AppError.badRequest("Publish the blank into Blank Forms Templates, or a folder under it.");
  const parentId = chosen.linkedPath ? chosen.parentId : chosen.id;
  if (parentId == null) throw AppError.badRequest("Choose a folder under Blank Forms Templates.");
  const hadPending = await pendingRevisionFor(db, id);
  const saved = await saveBuiltForm(db, actor, id, {
    structure: structure ?? current.structure,
    mode: "publish",
    newRevision: revision?.newRevision,
    changeDescription: revision?.changeDescription,
  });
  const [form] = await db.select().from(builtForms).where(eq(builtForms.id, id));
  if (!form) throw AppError.notFound("Form");
  const submitted = saved.pendingRevisionId != null && saved.pendingRevisionId !== hadPending?.id;
  const live = form.status === "published";
  // A form that is already live keeps its blank in the folder. A first publish files the blank when it is approved.
  const leafId = live ? await fileTemplateLeaf(db, form, parentId, folders) : null;
  await db.update(builtForms).set({ folderId: parentId, ...(live && !submitted ? { publishedAt: new Date() } : {}) }).where(eq(builtForms.id, id));
  const person = await who(db, actor);
  const place = folderLocationLabel(folders, parentId);
  if (submitted) {
    const summary = `${person.label} chose ${place} for "${form.title}" REV ${saved.pendingRevision}. The blank is filed there once the revision is approved. ${person.when}.`;
    await recordAuditTrail(db, {
      entityType: AUDIT,
      entityId: id,
      action: "update",
      changes: { summary, revision: saved.pendingRevision, folderId: parentId, folder: place, status: "pending" },
      performedBy: actor.id,
    });
  } else {
    const numberLine = form.formNumber?.trim() ? `Form number ${form.formNumber.trim()}.` : "The form number is still blank.";
    const summary = `${person.label} published "${form.title}" revision ${form.revision} into ${place} on ${person.when}. ${numberLine} Opening that blank starts a fresh copy.`;
    await recordAuditTrail(db, {
      entityType: AUDIT,
      entityId: id,
      action: "status_change",
      changes: { summary, revision: form.revision, folderId: parentId, folder: place },
      performedBy: actor.id,
    });
  }
  return { ...saved, status: form.status, folderId: parentId, leafId, submitted };
}

/** Puts a published form's blank in Blank Forms Templates, or moves and renames the one that is already there. */
async function fileTemplateLeaf(db: Db, form: typeof builtForms.$inferSelect, parentId: number, folders?: Awaited<ReturnType<typeof foldersOf>>): Promise<number | null> {
  const all = folders ?? (await foldersOf(db));
  const path = `${TEMPLATE_PREFIX}${form.id}`;
  const name = form.formNumber?.trim() ? `${form.formNumber.trim()} ${form.title}` : form.title;
  const existing = all.find((folder) => folder.linkedPath === path);
  if (existing) {
    await db.update(documentFolders).set({ name, parentId, updatedAt: new Date() }).where(eq(documentFolders.id, existing.id));
    return existing.id;
  }
  const siblings = all.filter((folder) => folder.parentId === parentId);
  const [created] = await db.insert(documentFolders).values({ name, parentId, sortOrder: siblings.length, linkedPath: path }).returning();
  return created?.id ?? null;
}

function decisionNote(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 1000) : "";
}

async function loadPendingRevision(db: Db, formId: number, revId: number) {
  const [form] = await db.select().from(builtForms).where(eq(builtForms.id, formId));
  if (!form) throw AppError.notFound("Form");
  const [row] = await db.select().from(builtFormRevisions).where(and(eq(builtFormRevisions.id, revId), eq(builtFormRevisions.formId, formId)));
  if (!row) throw AppError.notFound("Revision");
  if (row.status !== "pending") throw new AppError(`REV ${row.revision} was already ${row.status}.`, 409);
  return { form, row };
}

/**
 * The approver signs with their own signature PIN and the certification box, the same as any other sign-off.
 * Returns the name and date stamp kept on the revision.
 */
export async function approvalSignature(db: Db, actor: { id: number }, input: { pin?: unknown; certified?: unknown }): Promise<string> {
  if (input.certified !== true) throw AppError.badRequest("Check the certification box before approving.");
  if (typeof input.pin !== "string") throw AppError.badRequest("Enter a 4-digit PIN.");
  const verified = await verifySignaturePin(actor.id, input.pin);
  const [profile] = await db.select({ profile: company.profile }).from(company).limit(1);
  return formatSignatureStamp(verified.displayName, new Date(), profile?.profile?.timezone || "UTC");
}

/** Makes a pending revision the one fillers open. The REV is the one its author typed. */
export async function approveRevision(db: Db, actor: Actor, formId: number, revId: number, input: { note?: unknown; pin?: unknown; certified?: unknown }) {
  await requireApprover(db, actor);
  const { form, row } = await loadPendingRevision(db, formId, revId);
  const note = decisionNote(input.note);
  const signature = await approvalSignature(db, actor, input);
  const [decided] = await db
    .update(builtFormRevisions)
    .set({ status: "approved", approvedBy: actor.id, approvedAt: new Date(), decisionNote: note || null, approvalSignature: signature })
    .where(and(eq(builtFormRevisions.id, revId), eq(builtFormRevisions.status, "pending")))
    .returning();
  if (!decided) throw new AppError(`REV ${row.revision} was already decided.`, 409);
  const [live] = await db
    .update(builtForms)
    .set({ revision: row.revision, status: "published", publishedStructure: row.structure, publishedAt: new Date(), updatedAt: new Date() })
    .where(eq(builtForms.id, formId))
    .returning();
  if (!live) throw AppError.notFound("Form");
  if (live.folderId != null) await fileTemplateLeaf(db, live, live.folderId);
  const person = await who(db, actor);
  const name = live.formNumber?.trim() ? `${live.formNumber.trim()} ${live.title}` : live.title;
  const summary = `${person.label} approved ${name} REV ${row.revision} on ${person.when}${note ? `: ${endSentence(note)}` : "."}`;
  await recordAuditTrail(db, {
    entityType: AUDIT,
    entityId: formId,
    action: "status_change",
    changes: { summary, revision: row.revision, previousRevision: form.revision, decision: "approved", note: note || null, signature },
    performedBy: actor.id,
  });
  return { form: publicForm(live, null), notice: MASTER_LIST_NOTICE };
}

/** Turns a pending revision down. The live version and its REV stay as they were. */
export async function rejectRevision(db: Db, actor: Actor, formId: number, revId: number, input: { note?: unknown }) {
  await requireApprover(db, actor);
  const note = decisionNote(input.note);
  if (!note) throw AppError.badRequest("Enter a note explaining why this revision is rejected.");
  const { form, row } = await loadPendingRevision(db, formId, revId);
  const [decided] = await db
    .update(builtFormRevisions)
    .set({ status: "rejected", approvedBy: actor.id, approvedAt: new Date(), decisionNote: note })
    .where(and(eq(builtFormRevisions.id, revId), eq(builtFormRevisions.status, "pending")))
    .returning();
  if (!decided) throw new AppError(`REV ${row.revision} was already decided.`, 409);
  const person = await who(db, actor);
  const name = form.formNumber?.trim() ? `${form.formNumber.trim()} ${form.title}` : form.title;
  const summary = `${person.label} rejected ${name} REV ${row.revision} on ${person.when}: ${endSentence(note)}`;
  await recordAuditTrail(db, {
    entityType: AUDIT,
    entityId: formId,
    action: "status_change",
    changes: { summary, revision: row.revision, decision: "rejected", note },
    performedBy: actor.id,
  });
  return { form: publicForm(form, null) };
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

export async function openBuiltFill(db: Db, actor: Actor, formId: number, recordNumber?: unknown, siteId?: number | null) {
  await requireFillEditor(db, actor, "fill in");
  const [form] = await db.select().from(builtForms).where(eq(builtForms.id, formId));
  if (!form) throw AppError.notFound("Form");
  if (form.status !== "published" || form.publishedStructure == null) {
    const waiting = await pendingRevisionFor(db, formId);
    throw AppError.badRequest(waiting ? `REV ${waiting.revision} is waiting for approval. A copy can be filled once it is approved.` : "Publish the form before filling a copy.");
  }
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
  const numberBody: Record<string, unknown> = { recordNumber, formId: form.id };
  await applyRecordNumber(db, numberBody, BUILT_FILL_NUMBER);
  const [created] = await db
    .insert(builtFormFills)
    .values({
      formId: form.id,
      templateRevision: copy.templateRevision,
      templateFormNumber: copy.templateFormNumber,
      structure: copy.structure,
      title: form.title,
      answers: copy.answers,
      recordNumber: (numberBody.recordNumber as string | null) ?? null,
      createdBy: actor.id,
      updatedBy: actor.id,
    })
    .returning();
  if (!created) throw new Error("Could not open a copy");
  await stampRecordSite(db, "built_form_fills", created.id, siteId);
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
  const folder = row.folderId == null ? null : folderLocationLabel(await foldersOf(db), row.folderId);
  return { ...row, folderLabel: folder };
}

function mergeAnswers(previous: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...incoming };
  // A signature stamp only ever comes from the sign step. One sent with a save is dropped.
  for (const [key, value] of Object.entries(next)) {
    if (value && typeof value === "object" && (value as { stamped?: boolean }).stamped === true && JSON.stringify(previous[key]) !== JSON.stringify(value)) delete next[key];
  }
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

export async function saveBuiltFill(db: Db, actor: Actor, id: number, input: { title?: string; answers?: Record<string, unknown>; recordNumber?: unknown }) {
  await requireFillEditor(db, actor, "save");
  const [current] = await db.select().from(builtFormFills).where(eq(builtFormFills.id, id));
  if (!current) throw AppError.notFound("Filled form");
  const [template] = await db.select().from(builtForms).where(eq(builtForms.id, current.formId));
  const previousAnswers = (current.answers ?? {}) as Record<string, unknown>;
  const merged = input.answers ? mergeAnswers(previousAnswers, input.answers) : previousAnswers;
  // Formula cells are worked out here from the copy's own layout. A value sent for one is not kept.
  const answers = (input.answers ? recomputeGridAnswers(current.structure, merged) : null) ?? merged;
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
  const patch: Record<string, unknown> = {
    title: input.title?.trim() || current.title,
    answers: kept.answers,
    templateRevision: current.templateRevision,
    structure: current.structure,
    updatedBy: actor.id,
    updatedAt: new Date(),
  };
  let numberChange: { numberEdit: { label: string; from: string; to: string } } | null = null;
  if ("recordNumber" in input) {
    const numberBody: Record<string, unknown> = { recordNumber: input.recordNumber, formId: current.formId };
    numberChange = await applyRecordNumber(db, numberBody, BUILT_FILL_NUMBER, { id, current: current.recordNumber, row: current });
    patch.recordNumber = (numberBody.recordNumber as string | null) ?? null;
  }
  const [updated] = await db
    .update(builtFormFills)
    .set(patch)
    .where(eq(builtFormFills.id, id))
    .returning();
  const edits = [
    ...(numberChange ? [numberChange.numberEdit] : []),
    ...scalarEdits({ title: current.title }, { title: String(patch.title ?? current.title) }, ["title"]),
    ...scalarEdits(previousAnswers, (kept.answers ?? {}) as Record<string, unknown>),
  ];
  // Every save is in the audit log, with or without changes, so the record shows each time it was saved.
  const person = await who(db, actor);
  const label = fillLabel(String(patch.title ?? current.title), (patch.recordNumber as string | null | undefined) ?? current.recordNumber);
  const changed = edits.length === 0 ? "No values changed." : `${edits.length} value${edits.length === 1 ? "" : "s"} changed.`;
  await recordAuditTrail(db, {
    entityType: "BuiltFormFill",
    entityId: id,
    action: "update",
    changes: changesWithNumberEdit({ event: "form_saved", summary: `${person.label} saved ${label} on ${person.when}. ${changed}`, edits }, numberChange),
    performedBy: actor.id,
  });
  if (template) {
    const [after] = await db.select().from(builtForms).where(eq(builtForms.id, template.id));
    if (!after || after.revision !== template.revision || JSON.stringify(after.structure) !== JSON.stringify(template.structure)) {
      throw new Error("Saving a filled copy changed the template");
    }
  }
  return updated;
}

export async function beginBuiltFillEdit(db: Db, actor: Actor, id: number, body?: unknown) {
  await requireFillEditor(db, actor, "edit");
  const action = editActionFrom(body);
  const [row] = await db.select({ id: builtFormFills.id }).from(builtFormFills).where(eq(builtFormFills.id, id));
  if (!row) throw AppError.notFound("Filled form");
  await recordEditSession(db, { entityType: "BuiltFormFill", label: "filled form", id, userId: actor.id, action });
  return { editing: action === "start" };
}

export async function deleteBuiltFill(db: Db, actor: Actor, id: number) {
  const documents = await getUserAccessLevel(db, actor, "documents");
  const access = await formBuilderAccess(db, actor);
  if (documents !== "edit" && !canEditFormBuilder(access)) {
    throw AppError.forbidden("You don't have permission to delete this record.");
  }
  const [row] = await db.select().from(builtFormFills).where(eq(builtFormFills.id, id));
  if (!row) throw AppError.notFound("Filled form");
  await db.delete(builtFormFills).where(eq(builtFormFills.id, id));
  const [still] = await db.select({ id: builtFormFills.id }).from(builtFormFills).where(eq(builtFormFills.id, id));
  if (still) return;
  const path = `${FILL_PREFIX}${id}`;
  await db.delete(documentFolders).where(eq(documentFolders.linkedPath, path));
  await recordAuditTrail(db, {
    entityType: "BuiltFormFill",
    entityId: id,
    action: "delete",
    changes: { summary: `Deleted filled form "${row.title}"`, title: row.title, recordNumber: row.recordNumber },
    performedBy: actor.id,
  });
}

export async function fileBuiltFill(db: Db, actor: Actor, id: number, folderId: number) {
  await requireFillEditor(db, actor, "save");
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
  const [updated] = await db.update(builtFormFills).set({ folderId: parentId, updatedBy: actor.id, updatedAt: new Date() }).where(eq(builtFormFills.id, id)).returning();
  const folder = folderLocationLabel(folders, parentId);
  const previous = fill.folderId == null ? null : folderLocationLabel(folders, fill.folderId);
  const person = await who(db, actor);
  await recordAuditTrail(db, {
    entityType: "BuiltFormFill",
    entityId: id,
    action: "update",
    changes: {
      event: "form_filed",
      summary: `${person.label} saved ${fillLabel(fill.title, fill.recordNumber)} to ${folder} on ${person.when}.${previous && previous !== folder ? ` It was in ${previous}.` : ""}`,
      folder,
      ...(previous ? { previousFolder: previous } : {}),
    },
    performedBy: actor.id,
  });
  return { fill: updated, folder };
}

function fillLabel(title: string, recordNumber: string | null | undefined): string {
  return recordNumber ? `filled form ${recordNumber} ("${title}")` : `filled form "${title}"`;
}

/** Stamps one signature with the signer's PIN. The certification box must be ticked. A stamp is never replaced. */
export async function signBuiltFill(db: Db, actor: Actor, id: number, input: { fieldId: string; pin: string; certified?: unknown }) {
  await requireFillEditor(db, actor, "sign");
  const fieldId = input.fieldId.trim();
  if (!fieldId) throw AppError.badRequest("Choose the signature to stamp.");
  if (input.certified !== true) throw AppError.badRequest("Tick the certification box to sign.");
  const [fill] = await db.select().from(builtFormFills).where(eq(builtFormFills.id, id));
  if (!fill) throw AppError.notFound("Filled form");
  const kinds = gridCellKinds(fill.structure);
  if (kinds.length > 0 && !kinds.some((item) => item.key === fieldId && item.kind === "signature")) {
    throw AppError.badRequest("That cell is not a signature on this form.");
  }
  const current = ((fill.answers ?? {}) as Record<string, unknown>)[fieldId];
  if (current && typeof current === "object" && (current as { stamped?: boolean }).stamped === true) {
    throw AppError.badRequest("That signature is already stamped. A signature is not replaced.");
  }
  const verified = await verifySignaturePin(actor.id, input.pin);
  const [profile] = await db.select({ profile: company.profile }).from(company).limit(1);
  const stamp = formatSignatureStamp(verified.displayName, new Date(), profile?.profile?.timezone || "UTC");
  const text = `${stamp}. ${CERTIFY}`;
  const answers = { ...((fill.answers ?? {}) as Record<string, unknown>), [fieldId]: { stamped: true, text } };
  const [updated] = await db.update(builtFormFills).set({ answers, updatedBy: actor.id, updatedAt: new Date() }).where(and(eq(builtFormFills.id, id))).returning();
  const cell = fieldId.includes("!") ? `cell ${fieldId.split("!")[1]}` : "a signature";
  const person = await who(db, actor);
  await recordAuditTrail(db, {
    entityType: "BuiltFormFill",
    entityId: id,
    action: "update",
    changes: { event: "form_signed", summary: `${person.label} signed ${cell} on ${fillLabel(fill.title, fill.recordNumber)} with their PIN on ${person.when}. Stamp: ${stamp}.`, field: fieldId },
    performedBy: actor.id,
  });
  return updated;
}

/** A PDF of a filled grid copy that matches the screen. Anyone who can view the copy can download it; each download is logged. */
export async function exportBuiltFillPdf(db: Db, actor: Actor, id: number): Promise<{ bytes: Uint8Array; filename: string }> {
  await requireFiller(db, actor);
  const [fill] = await db.select().from(builtFormFills).where(eq(builtFormFills.id, id));
  if (!fill) throw AppError.notFound("Filled form");
  const structure = fill.structure as { kind?: unknown } | null;
  if (structure?.kind !== "grid") throw AppError.badRequest("Use Print for this form. Download PDF is for grid forms.");
  const folders = await foldersOf(db);
  const folderPath = fill.folderId == null ? null : folderLocationLabel(folders, fill.folderId);
  const person = await who(db, actor);
  const [profile] = await db.select({ name: company.name }).from(company).limit(1);
  const { bytes, layout } = await renderGridPdf({
    title: fill.title,
    formNumber: fill.templateFormNumber,
    revision: fill.templateRevision,
    recordNumber: fill.recordNumber,
    structure: fill.structure,
    answers: (fill.answers ?? {}) as Record<string, unknown>,
    folderPath,
    printedBy: person.label,
    printedAt: person.when,
    companyName: profile?.name ?? null,
  });
  const safe = (text: string) => text.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const filename = `${[safe(fill.templateFormNumber ?? "") || "Form", safe(fill.recordNumber ?? "") || String(fill.id), `Rev-${safe(fill.templateRevision) || "A"}`].join("_")}.pdf`;
  await recordAuditTrail(db, {
    entityType: "BuiltFormFill",
    entityId: id,
    action: "update",
    changes: {
      event: "pdf_export",
      summary: `${person.label} downloaded a PDF of ${fillLabel(fill.title, fill.recordNumber)} (REV ${fill.templateRevision}, ${layout.pages} page${layout.pages === 1 ? "" : "s"}) on ${person.when}.`,
      filename,
      pages: layout.pages,
    },
    performedBy: actor.id,
  });
  return { bytes, filename };
}

export async function importDocx(db: Db, actor: Actor, file: Buffer) {
  await requireEditor(db, actor);
  try {
    const imported = htmlFromDocx(file);
    return {
      html: sanitizeDocumentHtml(imported.html),
      header: cleanBand(imported.header, sanitizeBandHtml),
      footer: cleanBand(imported.footer, sanitizeBandHtml),
    };
  } catch {
    throw AppError.badRequest("Couldn't read that Word file. A .docx with headings and paragraphs can be imported. Older .doc files cannot.");
  }
}

const FOLDER_PATH_SPAN = /<span class="fb-folder-path"[^>]*>[\s\S]*?<\/span>/gi;

function escapeFolderPath(path: string): string {
  return path.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function applyFolderPath(html: string, path: string): string {
  if (!path) return html;
  return html.replace(FOLDER_PATH_SPAN, escapeFolderPath(path));
}

function prependFolderNote(band: DocumentBand | null, note: string): DocumentBand | null {
  if (!note) return band;
  if (!band) return { differentFirstPage: false, differentOddEven: false, defaultHtml: note, firstHtml: "", evenHtml: "" };
  return {
    ...band,
    defaultHtml: `${note}${band.defaultHtml}`,
    firstHtml: band.firstHtml ? `${note}${band.firstHtml}` : band.firstHtml,
    evenHtml: band.evenHtml ? `${note}${band.evenHtml}` : band.evenHtml,
  };
}

function withFolderPath(band: DocumentBand | null, path: string): DocumentBand | null {
  if (!band || !path) return band;
  return {
    ...band,
    defaultHtml: applyFolderPath(band.defaultHtml, path),
    firstHtml: applyFolderPath(band.firstHtml, path),
    evenHtml: applyFolderPath(band.evenHtml, path),
  };
}

export async function exportDocx(db: Db, actor: Actor, id: number) {
  await requireReader(db, actor);
  const [form] = await db.select().from(builtForms).where(eq(builtForms.id, id));
  if (!form) throw AppError.notFound("Form");
  if (form.kind !== "document") throw AppError.badRequest("Only a Word-style document can be downloaded as .docx.");
  const structure = form.structure as { html?: string; header?: unknown; footer?: unknown; chrome?: { place?: string; kind?: string }[] };
  const folders = await foldersOf(db);
  const leaf = folders.find((folder) => folder.linkedPath === `${TEMPLATE_PREFIX}${form.id}`);
  const path = leaf ? joinFolderPath(folderPathParts(folders, leaf.id)) : "";
  const html = applyFolderPath(typeof structure.html === "string" ? structure.html : "", path);
  const headerNote = (structure.chrome ?? []).filter((field) => field.place === "header" && field.kind === "folderPath").map(() => `<p>Folder path: ${escapeFolderPath(path)}</p>`).join("");
  const footerNote = (structure.chrome ?? []).filter((field) => field.place === "footer" && field.kind === "folderPath").map(() => `<p>Folder path: ${escapeFolderPath(path)}</p>`).join("");
  const bytes = await docxFromHtml(html, { docId: form.formNumber, rev: form.revision }, {
    header: withFolderPath(prependFolderNote(cleanBand(structure.header, sanitizeBandHtml), headerNote), path),
    footer: withFolderPath(prependFolderNote(cleanBand(structure.footer, sanitizeBandHtml), footerNote), path),
  });
  return { filename: `${form.title || "document"}.docx`, bytes };
}
