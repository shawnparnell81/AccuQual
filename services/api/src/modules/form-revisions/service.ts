/**
 * Revision history for the built-in forms (validation sheets, ISO and QMS forms, and the other forms the app ships).
 *
 * Their layout lives in the app, so a revision here is a controlled record: a person types the new REV and what
 * changed, and someone with the approve permission signs it with their PIN. The app never picks or changes a REV.
 * Filled copies keep the REV stamped on them when they were opened.
 */
import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { controlledFormTemplates } from "../../drizzle/schema/controlledForms.js";
import { formRevisionRecords } from "../../drizzle/schema/builtForms.js";
import { company } from "../../drizzle/schema/company.js";
import { users } from "../../drizzle/schema/users.js";
import type { Db } from "../../lib/requestDb.js";
import { getUserAccessLevel } from "../../middleware/departmentAccess.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { approvalSignature } from "../form-builder/service.js";
import { MAX_REVISION_LENGTH } from "../form-builder/revision.js";
import { FORM_BUILDER_APPROVE_PERMISSION } from "../roles/roleAccess.js";
import { roleHasPermission } from "../roles/rolePermissions.js";
import { formatUserLabel } from "../users/userDisplay.js";

export const AUDIT = "FormRevision";

export interface Actor {
  id: number;
  roleName: string | null;
  department: string | null;
}

async function access(db: Db, actor: Actor) {
  const [level, canApprove] = await Promise.all([
    getUserAccessLevel(db, actor, "documents"),
    roleHasPermission(db, actor.roleName, FORM_BUILDER_APPROVE_PERMISSION),
  ]);
  return { canRead: level !== "none", canEdit: level === "edit", canApprove };
}

async function loadForm(db: Db, formKey: string) {
  const [form] = await db.select().from(controlledFormTemplates).where(eq(controlledFormTemplates.formKey, formKey));
  if (!form) throw AppError.notFound("Form");
  return form;
}

async function who(db: Db, actor: Actor): Promise<{ label: string; when: string }> {
  const [person] = await db.select({ name: users.name, email: users.email, isActive: users.isActive }).from(users).where(eq(users.id, actor.id));
  const [profile] = await db.select({ profile: company.profile }).from(company).limit(1);
  const timeZone = profile?.profile?.timezone || "UTC";
  const when = new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date());
  return { label: formatUserLabel(person ? { ...person, isActive: person.isActive ?? true } : undefined, actor.id), when };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formName(form: { formId: string; title: string }): string {
  return form.formId?.trim() ? `${form.formId.trim()} ${form.title}` : form.title;
}

function endSentence(value: string): string {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

/** The REV of the last approved revision, or null when none has been recorded yet. */
async function currentRevision(db: Db, formKey: string): Promise<string | null> {
  const [row] = await db
    .select({ revision: formRevisionRecords.revision })
    .from(formRevisionRecords)
    .where(and(eq(formRevisionRecords.formKey, formKey), eq(formRevisionRecords.status, "approved")))
    .orderBy(desc(formRevisionRecords.approvedAt), desc(formRevisionRecords.id))
    .limit(1);
  return row?.revision ?? null;
}

export async function getFormRevisions(db: Db, actor: Actor, formKey: string) {
  const rights = await access(db, actor);
  if (!rights.canRead) throw AppError.forbidden("You can see a form's revisions once Documents is turned on for you.");
  const form = await loadForm(db, formKey);
  const author = alias(users, "author");
  const approver = alias(users, "approver");
  const rows = await db
    .select({
      row: formRevisionRecords,
      authorName: author.name,
      authorEmail: author.email,
      authorActive: author.isActive,
      approverName: approver.name,
      approverEmail: approver.email,
      approverActive: approver.isActive,
    })
    .from(formRevisionRecords)
    .leftJoin(author, eq(author.id, formRevisionRecords.createdBy))
    .leftJoin(approver, eq(approver.id, formRevisionRecords.approvedBy))
    .where(eq(formRevisionRecords.formKey, formKey))
    .orderBy(desc(formRevisionRecords.createdAt), desc(formRevisionRecords.id));
  const label = (id: number | null, name: string | null, email: string | null, active: boolean | null) =>
    id == null ? null : formatUserLabel(email == null ? undefined : { name, email, isActive: active ?? true }, id);
  const history = rows.map(({ row, ...people }) => ({
    id: row.id,
    revision: row.revision,
    previousRevision: row.previousRevision,
    description: row.description,
    status: row.status,
    createdAt: row.createdAt,
    createdByName: label(row.createdBy, people.authorName, people.authorEmail, people.authorActive),
    approvedAt: row.approvedAt,
    approvedByName: label(row.approvedBy, people.approverName, people.approverEmail, people.approverActive),
    decisionNote: row.decisionNote,
    approvalSignature: row.approvalSignature,
  }));
  const pending = history.find((row) => row.status === "pending") ?? null;
  return {
    formKey: form.formKey,
    formId: form.formId,
    title: form.title,
    currentRevision: await currentRevision(db, formKey),
    pendingRevision: pending?.revision ?? null,
    pendingRevisionId: pending?.id ?? null,
    canEdit: rights.canEdit,
    canApprove: rights.canApprove,
    history,
  };
}

/** Starts a new revision. The REV and the description are typed by the person; nothing is filled in for them. */
export async function startFormRevision(db: Db, actor: Actor, formKey: string, input: { newRevision?: unknown; changeDescription?: unknown }) {
  const rights = await access(db, actor);
  if (!rights.canEdit) throw AppError.forbidden("Starting a form revision needs edit access to Documents. An administrator can turn it on under Roles & Permissions.");
  const form = await loadForm(db, formKey);
  const current = await currentRevision(db, formKey);
  const revision = text(input.newRevision);
  const sameAsCurrent = current != null && revision.toLowerCase() === current.toLowerCase();
  if (!revision || sameAsCurrent) throw AppError.badRequest(current ? `Enter the new revision. It must be different from REV ${current}.` : "Enter the revision, such as A.");
  if (revision.length > MAX_REVISION_LENGTH) throw AppError.badRequest(`The revision can be at most ${MAX_REVISION_LENGTH} characters.`);
  const description = text(input.changeDescription).slice(0, 2000);
  if (!description) throw AppError.badRequest("Describe what changed in this revision.");
  const [waiting] = await db
    .select({ revision: formRevisionRecords.revision })
    .from(formRevisionRecords)
    .where(and(eq(formRevisionRecords.formKey, formKey), eq(formRevisionRecords.status, "pending")));
  if (waiting) throw new AppError(`REV ${waiting.revision} is waiting for approval. Approve or reject it before starting another revision.`, 409);
  try {
    await db.insert(formRevisionRecords).values({ formKey, revision, previousRevision: current, description, status: "pending", createdBy: actor.id });
  } catch {
    throw new AppError("Another revision of this form is already waiting for approval.", 409);
  }
  const person = await who(db, actor);
  const summary = `${person.label} started ${formName(form)} REV ${revision}${current ? ` (from REV ${current})` : ""} on ${person.when}: ${endSentence(description)}`;
  await recordAuditTrail(db, {
    entityType: AUDIT,
    entityId: form.id,
    action: "create",
    changes: { summary, formKey, revision, previousRevision: current, description, status: "pending" },
    performedBy: actor.id,
  });
  return getFormRevisions(db, actor, formKey);
}

async function loadPending(db: Db, formKey: string, id: number) {
  const [row] = await db.select().from(formRevisionRecords).where(and(eq(formRevisionRecords.id, id), eq(formRevisionRecords.formKey, formKey)));
  if (!row) throw AppError.notFound("Revision");
  if (row.status !== "pending") throw new AppError(`REV ${row.revision} was already ${row.status}.`, 409);
  return row;
}

function requireApprover(rights: { canApprove: boolean }) {
  if (!rights.canApprove) throw AppError.forbidden("Approving a form revision is not turned on for you. An administrator can turn it on under Roles & Permissions.");
}

/** Approves with the approver's PIN signature. The person who started the revision may approve it. */
export async function approveFormRevision(db: Db, actor: Actor, formKey: string, id: number, input: { note?: unknown; pin?: unknown; certified?: unknown }) {
  requireApprover(await access(db, actor));
  const form = await loadForm(db, formKey);
  const row = await loadPending(db, formKey, id);
  const note = text(input.note).slice(0, 1000);
  const signature = await approvalSignature(db, actor, input);
  const [decided] = await db
    .update(formRevisionRecords)
    .set({ status: "approved", approvedBy: actor.id, approvedAt: new Date(), decisionNote: note || null, approvalSignature: signature })
    .where(and(eq(formRevisionRecords.id, id), eq(formRevisionRecords.status, "pending")))
    .returning();
  if (!decided) throw new AppError(`REV ${row.revision} was already decided.`, 409);
  const person = await who(db, actor);
  const summary = `${person.label} approved ${formName(form)} REV ${row.revision} on ${person.when}${note ? `: ${endSentence(note)}` : "."}`;
  await recordAuditTrail(db, {
    entityType: AUDIT,
    entityId: form.id,
    action: "status_change",
    changes: { summary, formKey, revision: row.revision, previousRevision: row.previousRevision, decision: "approved", note: note || null, signature },
    performedBy: actor.id,
  });
  return getFormRevisions(db, actor, formKey);
}

export async function rejectFormRevision(db: Db, actor: Actor, formKey: string, id: number, input: { note?: unknown }) {
  requireApprover(await access(db, actor));
  const note = text(input.note).slice(0, 1000);
  if (!note) throw AppError.badRequest("Enter a note explaining why this revision is rejected.");
  const form = await loadForm(db, formKey);
  const row = await loadPending(db, formKey, id);
  const [decided] = await db
    .update(formRevisionRecords)
    .set({ status: "rejected", approvedBy: actor.id, approvedAt: new Date(), decisionNote: note })
    .where(and(eq(formRevisionRecords.id, id), eq(formRevisionRecords.status, "pending")))
    .returning();
  if (!decided) throw new AppError(`REV ${row.revision} was already decided.`, 409);
  const person = await who(db, actor);
  const summary = `${person.label} rejected ${formName(form)} REV ${row.revision} on ${person.when}: ${endSentence(note)}`;
  await recordAuditTrail(db, {
    entityType: AUDIT,
    entityId: form.id,
    action: "status_change",
    changes: { summary, formKey, revision: row.revision, decision: "rejected", note },
    performedBy: actor.id,
  });
  return getFormRevisions(db, actor, formKey);
}
