import { and, desc, eq, inArray, max } from "drizzle-orm";
import type { TenantDb } from "../../lib/tenantScope.js";
import { controlledVersions, type ControlledVersion, type VersionSubject } from "../../drizzle/schema/versioning.js";
import { users } from "../../drizzle/schema/users.js";
import { AppError } from "../../utils/appError.js";
import { logger } from "../../utils/logger.js";
import type { Department } from "../../middleware/departmentAccess.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { notifyDepartment, sendEmail } from "../notifications/notification.service.js";
import type { DiffResult } from "./diff.js";

// The shared draft -> review -> publish engine behind workflows, the Management
// Review record and the Context of the Organization analysis. Everything
// subject-specific (what a payload is, how it is validated, what "publishing"
// writes, how two versions are compared) lives in a SubjectAdapter; the
// lifecycle rules live here once.

export interface Issue {
  code: string;
  message: string;
  nodeId?: string;
  edge?: string;
}

export interface SubjectAdapter {
  subject: VersionSubject;
  /** entityType used on audit trail entries. */
  entityType: string;
  /** Human noun for messages, e.g. "workflow". */
  noun: string;
  /** The live record's current state, used to seed version 1 for subjects that pre-date versioning. Throws 404 if the subject does not exist. */
  loadLive(db: TenantDb, tenantId: number, subjectId: number): Promise<{ payload: Record<string, unknown>; version: number | null; author: number | null; exists: boolean }>;
  /** Empty starting payload for a subject with no content yet. */
  blank(): Record<string, unknown>;
  /** Errors block submitting/publishing; warnings are shown only. */
  validate(payload: Record<string, unknown>): { errors: Issue[]; warnings: Issue[] };
  /** Writes a version's payload into the live record. Runs inside the publishing transaction. */
  apply(db: TenantDb, tenantId: number, subjectId: number, payload: Record<string, unknown>, info: { versionNumber: number; actor: number; firstPublish: boolean; previousLive: Record<string, unknown> | null }): Promise<void>;
  diff(before: Record<string, unknown>, after: Record<string, unknown>): DiffResult;
  /** Departments told when a version is published. */
  notifyDepartments: Department[];
}

export interface Actor {
  id: number;
  roleName: string | null;
}

const conflict = (message: string) => new AppError(message, 409);

async function audit(db: TenantDb, adapter: SubjectAdapter, tenantId: number, subjectId: number, action: "create" | "update" | "status_change" | "delete", actor: number | undefined, changes: Record<string, unknown>) {
  await recordAuditTrail(db, { tenantId, entityType: adapter.entityType, entityId: subjectId, action, changes, performedBy: actor });
}

/** Gives a subject that pre-dates versioning its version 1 (the live record as it stands), so the timeline starts from truth, not from nothing. */
export async function ensureBootstrapped(db: TenantDb, adapter: SubjectAdapter, tenantId: number, subjectId: number): Promise<void> {
  const live = await adapter.loadLive(db, tenantId, subjectId); // 404s for a subject that does not exist
  const [any] = await db
    .select({ id: controlledVersions.id })
    .from(controlledVersions)
    .where(and(eq(controlledVersions.tenantId, tenantId), eq(controlledVersions.subjectType, adapter.subject), eq(controlledVersions.subjectId, subjectId)))
    .limit(1);
  if (any) return;
  await db.insert(controlledVersions).values({
    tenantId,
    subjectType: adapter.subject,
    subjectId,
    versionNumber: live.version && live.version > 0 ? live.version : 1,
    status: "published",
    payload: live.exists ? live.payload : adapter.blank(),
    metadata: { bootstrapped: true, note: "Version 1 is the record as it stood when version control started." },
    createdBy: live.author,
    publishedBy: live.author,
    publishedAt: new Date(),
  }).onConflictDoNothing(); // two first requests may race; either one seeds version 1
}

export async function listVersions(db: TenantDb, adapter: SubjectAdapter, tenantId: number, subjectId: number) {
  await ensureBootstrapped(db, adapter, tenantId, subjectId);
  const rows = await db
    .select()
    .from(controlledVersions)
    .where(and(eq(controlledVersions.tenantId, tenantId), eq(controlledVersions.subjectType, adapter.subject), eq(controlledVersions.subjectId, subjectId)))
    .orderBy(desc(controlledVersions.versionNumber));
  const names = await userNames(db, rows.flatMap((r) => [r.createdBy, r.submittedBy, r.reviewedBy, r.publishedBy]));
  // The list omits payloads (they can be large); GET one version returns it.
  return rows.map(({ payload: _payload, ...v }) => ({
    ...v,
    createdByName: nameOf(names, v.createdBy),
    submittedByName: nameOf(names, v.submittedBy),
    reviewedByName: nameOf(names, v.reviewedBy),
    publishedByName: nameOf(names, v.publishedBy),
  }));
}

async function userNames(db: TenantDb, ids: (number | null)[]): Promise<Map<number, string>> {
  const unique = [...new Set(ids.filter((i): i is number => typeof i === "number"))];
  if (unique.length === 0) return new Map();
  const rows = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r.name ?? r.email]));
}
const nameOf = (m: Map<number, string>, id: number | null) => (id === null ? null : (m.get(id) ?? null));

export async function getVersion(db: TenantDb, adapter: SubjectAdapter, tenantId: number, subjectId: number, versionId: number): Promise<ControlledVersion> {
  const [row] = await db
    .select()
    .from(controlledVersions)
    .where(and(eq(controlledVersions.id, versionId), eq(controlledVersions.tenantId, tenantId), eq(controlledVersions.subjectType, adapter.subject), eq(controlledVersions.subjectId, subjectId)));
  if (!row) throw AppError.notFound("Version");
  return row;
}

/** The subject's published version and its open (draft or in-review) version, if any. */
export async function getCurrent(db: TenantDb, adapter: SubjectAdapter, tenantId: number, subjectId: number) {
  await ensureBootstrapped(db, adapter, tenantId, subjectId);
  const rows = await db
    .select()
    .from(controlledVersions)
    .where(and(eq(controlledVersions.tenantId, tenantId), eq(controlledVersions.subjectType, adapter.subject), eq(controlledVersions.subjectId, subjectId), inArray(controlledVersions.status, ["published", "draft", "in_review"])))
    .orderBy(desc(controlledVersions.versionNumber));
  const open = rows.find((r) => r.status === "draft" || r.status === "in_review") ?? null;
  const published = rows.find((r) => r.status === "published") ?? null;
  const names = await userNames(db, [open?.createdBy ?? null, open?.submittedBy ?? null, open?.reviewedBy ?? null, published?.publishedBy ?? null]);
  return {
    published: published && { ...published, publishedByName: nameOf(names, published.publishedBy) },
    open: open && { ...open, createdByName: nameOf(names, open.createdBy), submittedByName: nameOf(names, open.submittedBy), reviewedByName: nameOf(names, open.reviewedBy) },
  };
}

async function nextNumber(db: TenantDb, adapter: SubjectAdapter, tenantId: number, subjectId: number): Promise<number> {
  const [row] = await db
    .select({ n: max(controlledVersions.versionNumber) })
    .from(controlledVersions)
    .where(and(eq(controlledVersions.tenantId, tenantId), eq(controlledVersions.subjectType, adapter.subject), eq(controlledVersions.subjectId, subjectId)));
  return (row?.n ?? 0) + 1;
}

async function openVersion(db: TenantDb, adapter: SubjectAdapter, tenantId: number, subjectId: number) {
  const [row] = await db
    .select()
    .from(controlledVersions)
    .where(and(eq(controlledVersions.tenantId, tenantId), eq(controlledVersions.subjectType, adapter.subject), eq(controlledVersions.subjectId, subjectId), inArray(controlledVersions.status, ["draft", "in_review"])));
  return row ?? null;
}

async function publishedVersion(db: TenantDb, adapter: SubjectAdapter, tenantId: number, subjectId: number) {
  const [row] = await db
    .select()
    .from(controlledVersions)
    .where(and(eq(controlledVersions.tenantId, tenantId), eq(controlledVersions.subjectType, adapter.subject), eq(controlledVersions.subjectId, subjectId), eq(controlledVersions.status, "published")));
  return row ?? null;
}

/** Starts a new draft as a copy of the published version (or of `fromPayload` for a brand-new subject). */
export async function createDraft(
  db: TenantDb,
  adapter: SubjectAdapter,
  tenantId: number,
  subjectId: number,
  actor: Actor,
  opts: { payload?: Record<string, unknown>; summary?: string } = {},
): Promise<ControlledVersion> {
  await ensureBootstrapped(db, adapter, tenantId, subjectId);
  const existing = await openVersion(db, adapter, tenantId, subjectId);
  if (existing) throw conflict(`There is already an open ${adapter.noun} version (v${existing.versionNumber}, ${existing.status.replace("_", " ")}). Finish or discard it first.`);
  const published = await publishedVersion(db, adapter, tenantId, subjectId);
  const number = await nextNumber(db, adapter, tenantId, subjectId);
  const [created] = await db
    .insert(controlledVersions)
    .values({
      tenantId,
      subjectType: adapter.subject,
      subjectId,
      versionNumber: number,
      status: "draft",
      payload: opts.payload ?? published?.payload ?? adapter.blank(),
      metadata: opts.summary ? { summary: opts.summary } : {},
      basedOnVersion: published?.versionNumber ?? null,
      createdBy: actor.id,
    })
    .returning();
  await audit(db, adapter, tenantId, subjectId, "create", actor.id, { event: "draft_created", version: number, basedOn: published?.versionNumber ?? null });
  return created!;
}

/** Version 1 of a subject created through the versioned flow (a brand-new workflow): a draft with nothing published before it. */
export async function createInitialDraft(db: TenantDb, adapter: SubjectAdapter, tenantId: number, subjectId: number, actor: Actor, payload: Record<string, unknown>): Promise<ControlledVersion> {
  const [created] = await db
    .insert(controlledVersions)
    .values({ tenantId, subjectType: adapter.subject, subjectId, versionNumber: 1, status: "draft", payload, metadata: { summary: "Initial version" }, createdBy: actor.id })
    .returning();
  await audit(db, adapter, tenantId, subjectId, "create", actor.id, { event: "draft_created", version: 1, basedOn: null });
  return created!;
}

const AUDIT_EDIT_WINDOW_MS = 10 * 60_000;

/** Replaces a draft's content (autosave). Only a draft can be edited; in-review and published versions are locked. */
export async function saveDraft(
  db: TenantDb,
  adapter: SubjectAdapter,
  tenantId: number,
  subjectId: number,
  versionId: number,
  actor: Actor,
  input: { payload?: Record<string, unknown>; summary?: string },
): Promise<ControlledVersion> {
  const v = await getVersion(db, adapter, tenantId, subjectId, versionId);
  if (v.status !== "draft") throw conflict(v.status === "in_review" ? "This version is in review and can't be edited. Ask the reviewer to send it back, or start again from the published version." : "Only a draft can be edited — published versions are frozen.");

  // Every autosave would otherwise write an audit row; record the edit once per window instead, with who and when.
  const lastAudited = typeof v.metadata?.editAuditedAt === "string" ? Date.parse(v.metadata.editAuditedAt as string) : 0;
  const shouldAudit = Date.now() - lastAudited > AUDIT_EDIT_WINDOW_MS || v.metadata?.editAuditedBy !== actor.id;
  const metadata = { ...v.metadata, ...(input.summary !== undefined ? { summary: input.summary } : {}), ...(shouldAudit ? { editAuditedAt: new Date().toISOString(), editAuditedBy: actor.id } : {}) };

  const [updated] = await db
    .update(controlledVersions)
    .set({ ...(input.payload ? { payload: input.payload } : {}), metadata, updatedAt: new Date(), updatedBy: actor.id })
    .where(eq(controlledVersions.id, v.id))
    .returning();
  if (shouldAudit) await audit(db, adapter, tenantId, subjectId, "update", actor.id, { event: "draft_edited", version: v.versionNumber });
  return updated!;
}

/** Discards an unpublished draft. */
export async function discardDraft(db: TenantDb, adapter: SubjectAdapter, tenantId: number, subjectId: number, versionId: number, actor: Actor): Promise<void> {
  const v = await getVersion(db, adapter, tenantId, subjectId, versionId);
  if (v.status !== "draft") throw conflict("Only a draft can be discarded.");
  await db.delete(controlledVersions).where(eq(controlledVersions.id, v.id));
  await audit(db, adapter, tenantId, subjectId, "delete", actor.id, { event: "draft_discarded", version: v.versionNumber });
}

/** draft -> in_review. The content must pass the subject's validation first. */
export async function submitForReview(db: TenantDb, adapter: SubjectAdapter, tenantId: number, subjectId: number, versionId: number, actor: Actor, notes?: string): Promise<ControlledVersion> {
  const v = await getVersion(db, adapter, tenantId, subjectId, versionId);
  if (v.status !== "draft") throw conflict("Only a draft can be sent for review.");
  const report = adapter.validate(v.payload);
  if (report.errors.length > 0) throw new AppError(`This ${adapter.noun} can't be sent for review yet: ${report.errors[0]!.message}`, 422, { errors: report.errors, warnings: report.warnings });

  const [updated] = await db
    .update(controlledVersions)
    .set({ status: "in_review", submittedBy: actor.id, submittedAt: new Date(), reviewDecision: null, reviewedBy: null, reviewedAt: null, reviewNotes: notes ?? null })
    .where(eq(controlledVersions.id, v.id))
    .returning();
  await audit(db, adapter, tenantId, subjectId, "status_change", actor.id, { event: "submitted_for_review", version: v.versionNumber, notes: notes ?? null });
  return updated!;
}

/**
 * The reviewer's decision on an in-review version. Approval leaves it in_review, ready to publish; rejection sends it
 * back to draft with the reviewer's notes. A reviewer may not review their own submission — except an admin, so a
 * one-person organization is not stuck — and that self-review is recorded as such.
 */
export async function reviewVersion(db: TenantDb, adapter: SubjectAdapter, tenantId: number, subjectId: number, versionId: number, actor: Actor, decision: "approved" | "rejected", notes?: string): Promise<ControlledVersion> {
  const v = await getVersion(db, adapter, tenantId, subjectId, versionId);
  if (v.status !== "in_review") throw conflict("Only a version that is in review can be reviewed.");
  const selfReview = v.submittedBy === actor.id;
  if (selfReview && actor.roleName !== "admin" && actor.roleName !== "platform_admin") {
    throw AppError.forbidden("You submitted this version, so someone else has to review it.");
  }
  if (decision === "rejected" && !notes?.trim()) throw AppError.badRequest("Say why it is being sent back, so the author knows what to fix.");

  const [updated] = await db
    .update(controlledVersions)
    .set(
      decision === "approved"
        ? { reviewDecision: "approved", reviewedBy: actor.id, reviewedAt: new Date(), reviewNotes: notes ?? null }
        : { status: "draft", reviewDecision: "rejected", reviewedBy: actor.id, reviewedAt: new Date(), reviewNotes: notes ?? null },
    )
    .where(eq(controlledVersions.id, v.id))
    .returning();
  await audit(db, adapter, tenantId, subjectId, "status_change", actor.id, { event: decision === "approved" ? "review_approved" : "review_rejected", version: v.versionNumber, notes: notes ?? null, ...(selfReview ? { selfReviewed: true } : {}) });
  return updated!;
}

/**
 * in_review + approved -> published. Re-validates, writes the payload into the live record, archives the version it
 * replaces, and tells the people who need to know. Everything happens in the request's transaction, so a failure
 * anywhere leaves the previous version live.
 */
export async function publishVersion(db: TenantDb, adapter: SubjectAdapter, tenantId: number, subjectId: number, versionId: number, actor: Actor): Promise<ControlledVersion> {
  const v = await getVersion(db, adapter, tenantId, subjectId, versionId);
  if (v.status !== "in_review") throw conflict("Only a version that is in review can be published.");
  if (v.reviewDecision !== "approved") throw conflict("A reviewer has to approve this version before it can be published.");

  const report = adapter.validate(v.payload);
  if (report.errors.length > 0) throw new AppError(`Can't publish: ${report.errors[0]!.message}`, 422, { errors: report.errors, warnings: report.warnings });

  const previous = await publishedVersion(db, adapter, tenantId, subjectId);
  const live = await adapter.loadLive(db, tenantId, subjectId);
  await adapter.apply(db, tenantId, subjectId, v.payload, { versionNumber: v.versionNumber, actor: actor.id, firstPublish: !previous, previousLive: live.exists ? live.payload : null });

  if (previous) await db.update(controlledVersions).set({ status: "archived" }).where(eq(controlledVersions.id, previous.id));
  const [published] = await db.update(controlledVersions).set({ status: "published", publishedBy: actor.id, publishedAt: new Date() }).where(eq(controlledVersions.id, v.id)).returning();
  await audit(db, adapter, tenantId, subjectId, "status_change", actor.id, { event: "published", version: v.versionNumber, replaced: previous?.versionNumber ?? null, ...(v.isRollback ? { rollbackTo: v.basedOnVersion } : {}) });

  await notifyPublished(db, adapter, tenantId, subjectId, v, actor).catch((err) => logger.error("Publish notification failed", { err: String(err), subject: adapter.subject, subjectId }));
  return published!;
}

async function notifyPublished(db: TenantDb, adapter: SubjectAdapter, tenantId: number, subjectId: number, v: ControlledVersion, actor: Actor) {
  const subject = `${adapter.noun[0]!.toUpperCase()}${adapter.noun.slice(1)} version ${v.versionNumber} was published`;
  const body = `A new version of the ${adapter.noun} is now in force (version ${v.versionNumber}${v.isRollback ? `, restoring version ${v.basedOnVersion}` : ""}).`;
  for (const department of adapter.notifyDepartments) await notifyDepartment(db, { tenantId, department, subject, body });
  const names = await db.select({ email: users.email, id: users.id }).from(users).where(inArray(users.id, [v.createdBy, v.submittedBy].filter((i): i is number => typeof i === "number" && i !== actor.id)));
  for (const u of names) await sendEmail({ to: u.email, subject, body });
}

/** Rollback: a new draft whose content is an earlier version's. It still goes through review and publishing like any other change. */
export async function rollbackTo(db: TenantDb, adapter: SubjectAdapter, tenantId: number, subjectId: number, versionNumber: number, actor: Actor): Promise<ControlledVersion> {
  await ensureBootstrapped(db, adapter, tenantId, subjectId);
  const [target] = await db
    .select()
    .from(controlledVersions)
    .where(and(eq(controlledVersions.tenantId, tenantId), eq(controlledVersions.subjectType, adapter.subject), eq(controlledVersions.subjectId, subjectId), eq(controlledVersions.versionNumber, versionNumber)));
  if (!target) throw AppError.notFound("Version");
  if (target.status !== "published" && target.status !== "archived") throw conflict("You can only roll back to a version that was published.");
  if (target.status === "published") throw conflict("That version is already the live one.");

  const existing = await openVersion(db, adapter, tenantId, subjectId);
  if (existing) throw conflict(`There is already an open ${adapter.noun} version (v${existing.versionNumber}). Finish or discard it first.`);

  const number = await nextNumber(db, adapter, tenantId, subjectId);
  const [created] = await db
    .insert(controlledVersions)
    .values({
      tenantId,
      subjectType: adapter.subject,
      subjectId,
      versionNumber: number,
      status: "draft",
      payload: target.payload,
      metadata: { summary: `Rollback to version ${versionNumber}` },
      basedOnVersion: versionNumber,
      isRollback: true,
      createdBy: actor.id,
    })
    .returning();
  await audit(db, adapter, tenantId, subjectId, "create", actor.id, { event: "rollback_draft_created", version: number, rollbackTo: versionNumber });
  return created!;
}

/** Compares a version with another (by default the one just before it) and records that a comparison was made. */
export async function diffVersions(db: TenantDb, adapter: SubjectAdapter, tenantId: number, subjectId: number, versionId: number, againstVersionId: number | undefined, actor: Actor) {
  await ensureBootstrapped(db, adapter, tenantId, subjectId);
  const after = await getVersion(db, adapter, tenantId, subjectId, versionId);
  let before: ControlledVersion | undefined;
  if (againstVersionId !== undefined) before = await getVersion(db, adapter, tenantId, subjectId, againstVersionId);
  else {
    const all = await db
      .select()
      .from(controlledVersions)
      .where(and(eq(controlledVersions.tenantId, tenantId), eq(controlledVersions.subjectType, adapter.subject), eq(controlledVersions.subjectId, subjectId)))
      .orderBy(desc(controlledVersions.versionNumber));
    before = all.find((r) => r.versionNumber < after.versionNumber);
  }
  const base = before?.payload ?? adapter.blank();
  const result = adapter.diff(base, after.payload);
  await audit(db, adapter, tenantId, subjectId, "update", actor.id, { event: "versions_compared", version: after.versionNumber, against: before?.versionNumber ?? null, ...result.summary });
  return { from: before ? { id: before.id, versionNumber: before.versionNumber, status: before.status } : null, to: { id: after.id, versionNumber: after.versionNumber, status: after.status }, ...result };
}
