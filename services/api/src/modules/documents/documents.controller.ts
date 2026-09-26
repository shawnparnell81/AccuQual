import type { Request, Response } from "express";
import { createReadStream, existsSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { documents, documentVersions, type Document, type DocumentVersion } from "../../drizzle/schema/documents.js";
import { controlledVersions } from "../../drizzle/schema/versioning.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";
import * as engine from "../versioning/versioning.service.js";
import { blankDocumentPayload } from "./documentPayload.js";
import { documentAdapter, isInsideStorage } from "./documentVersioning.js";

export const baseHandlers = crudFactory(documents, { entityName: "Document", idColumn: "id", softDelete: true });

/**
 * A new controlled document: the record plus its first draft (revision A). Nothing is in force until that draft has been
 * reviewed and published — see documentVersioning.ts. The title and category live in the revision itself, so they are
 * changed through a draft (with the change history a controlled document needs), never by editing the record directly.
 */
export const createDocumentHandler = asyncHandler(async (req: Request, res: Response) => {
  const db = req.db!;
  const { title, category } = req.body as { title: string; category?: string };
  const actor = { id: req.user!.id, roleName: req.user!.roleName };

  const [doc] = await db
    .insert(documents)
    .values({ title: title.trim(), category: category?.trim() || null, status: "draft", currentVersion: 0, ownerId: actor.id })
    .returning();
  if (!doc) throw new AppError("Failed to create the document", 500);
  const draft = await engine.createInitialDraft(db, documentAdapter, doc.id, actor, { ...blankDocumentPayload(), title: doc.title, category: doc.category ?? null } as unknown as Record<string, unknown>);
  await recordAuditTrail(db, { entityType: "Document", entityId: doc.id, action: "create", changes: { title: doc.title, category: doc.category }, performedBy: actor.id });
  res.status(201).json({ ...doc, openVersionId: draft.id });
});

/**
 * The old one-step endpoints let a revision be recorded, and approved by the same person, with nothing frozen and no
 * review. Revisions now go through a draft, a reviewer and publication (POST /documents/:id/draft, .../review,
 * .../publish), so these say so instead of quietly bypassing that.
 */
export const retiredRevisionHandler = asyncHandler(async (_req: Request, _res: Response) => {
  throw new AppError("This endpoint has been replaced. Revise a document by starting a draft (POST /documents/:id/draft), sending it for review, and publishing it once a reviewer approves.", 410);
});

/**
 * Sprint 2 fix — the real, one-way "retire an approved document" hop that
 * had no dedicated endpoint at all before this (only ever read as a
 * precondition by decideRetention/applyRetentionHandler/archiveHandler
 * above, never written by any code path). Only "approved -> obsolete" is
 * guarded here — real QMS documents are retired/superseded after release,
 * not before; there's no evidence anywhere in this module that a draft or
 * in-review document is meant to skip straight to obsolete.
 */
export const obsoleteHandler = asyncHandler(async (req: Request, res: Response) => {
  const documentId = Number(req.params.id);

  const [doc] = await req.db!.select().from(documents).where(and(eq(documents.id, documentId)));
  if (!doc) throw AppError.notFound("Document");
  if (doc.status !== "approved") {
    throw AppError.badRequest(`Cannot obsolete a document from status "${doc.status}" — must be "approved".`);
  }
  // A revision still being worked on would come back to life the moment it was published.
  const [open] = await req
    .db!.select({ n: controlledVersions.versionNumber })
    .from(controlledVersions)
    .where(and(eq(controlledVersions.subjectType, "document"), eq(controlledVersions.subjectId, documentId), eq(controlledVersions.status, "draft")));
  const [inReview] = await req
    .db!.select({ n: controlledVersions.versionNumber })
    .from(controlledVersions)
    .where(and(eq(controlledVersions.subjectType, "document"), eq(controlledVersions.subjectId, documentId), eq(controlledVersions.status, "in_review")));
  const pending = open ?? inReview;
  if (pending) throw new AppError(`Version ${pending.n} of this document is still being worked on. Discard it or finish it before retiring the document.`, 409);

  // Same M3 defense-in-depth fix as approveHandler above.
  const [updated] = await req.db!.update(documents).set({ status: "obsolete", updatedAt: new Date() }).where(and(eq(documents.id, documentId))).returning();

  await recordAuditTrail(req.db!, {
    entityType: "Document",
    entityId: documentId,
    action: "status_change",
    changes: { action: "obsolete", status: "obsolete" },
    performedBy: req.user?.id,
  });
  await publishEvent(WORKFLOW_STREAM, { module: "documents", event: "obsolete", entityId: documentId });

  res.json(updated);
});

/**
 * Streams a released revision's PDF back (the revision ledger's file). Only files inside this organization's own
 * storage folder are ever served: an older endpoint accepted any path as a "file URL", so a stored value is not trusted
 * to point where it should.
 */
export const downloadVersionHandler = asyncHandler(async (req: Request, res: Response) => {
  const versionId = Number(req.params.versionId);

  const [version] = await req.db!.select().from(documentVersions).where(and(eq(documentVersions.id, versionId)));
  if (!version) throw AppError.notFound("Document version");
  if (!version.fileUrl || /^https?:\/\//i.test(version.fileUrl) || !isInsideStorage(version.fileUrl) || !existsSync(version.fileUrl)) {
    throw AppError.notFound("Uploaded file for this version");
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `inline; filename="document-${version.documentId}-rev${version.version}.pdf"`);
  createReadStream(version.fileUrl).pipe(res);
});

export const historyHandler = asyncHandler(async (req: Request, res: Response) => {
  const versions = await req
    .db!.select()
    .from(documentVersions)
    .where(and(eq(documentVersions.documentId, Number(req.params.id))));
  res.json(versions);
});

export type ExpirationStatus = "expired" | "expiring_soon" | null;

/** Computed live at read time from expirationDate/expirationWarningDays — nothing stored, no worker. */
export function expirationStatus(doc: Pick<Document, "expirationDate" | "expirationWarningDays">): ExpirationStatus {
  if (!doc.expirationDate) return null;
  const now = new Date();
  const expiresAt = new Date(doc.expirationDate);
  if (now >= expiresAt) return "expired";
  const warnAt = new Date(expiresAt);
  warnAt.setDate(warnAt.getDate() - doc.expirationWarningDays);
  if (now >= warnAt) return "expiring_soon";
  return null;
}

export const listExpiringHandler = asyncHandler(async (req: Request, res: Response) => {
  const rows = await req.db!.select().from(documents);
  const expiring = rows
    .map((doc) => ({ ...doc, expirationStatus: expirationStatus(doc) }))
    .filter((doc) => doc.expirationStatus !== null);
  res.json(expiring);
});

interface RetentionDecision {
  eligible: boolean;
  reason?: string;
  action?: "archived" | "deleted";
}

/**
 * Shared by the bulk sweep (applyRetentionHandler) and the new single-record
 * action (archiveHandler) so the age-out math can't drift between them.
 * "Aged out" is measured from the current version's approval date, since
 * that's the closest thing this table has to "when did this stop being the
 * active document" (see the approval date the revision ledger records on publish).
 */
function decideRetention(doc: Document, currentVersion?: Pick<DocumentVersion, "approvedAt">): RetentionDecision {
  if (doc.status !== "obsolete") return { eligible: false, reason: `document is "${doc.status}", not "obsolete"` };
  if (doc.retentionState === "archived") return { eligible: false, reason: "already archived" };
  if (!currentVersion?.approvedAt) return { eligible: false, reason: "current version was never approved, so there's no date to measure retention from" };

  const ageOutAt = new Date(currentVersion.approvedAt);
  ageOutAt.setDate(ageOutAt.getDate() + doc.retentionPeriodDays);
  if (new Date() < ageOutAt) return { eligible: false, reason: `retention period hasn't elapsed yet (ages out ${ageOutAt.toISOString().slice(0, 10)})` };

  return { eligible: true, action: doc.retentionAction === "delete" ? "deleted" : "archived" };
}

/** Runs retention synchronously for every obsolete, aged-out document in the company — no worker, triggered on demand (POST /documents/retention/apply). */
export const applyRetentionHandler = asyncHandler(async (req: Request, res: Response) => {
  const db = req.db!;
  const obsolete = await db.select().from(documents).where(and(eq(documents.status, "obsolete")));

  const results: { documentId: number; action: string }[] = [];

  for (const doc of obsolete) {
    const [currentVersion] = await db
      .select()
      .from(documentVersions)
      .where(and(eq(documentVersions.documentId, doc.id), eq(documentVersions.version, doc.currentVersion)));

    const decision = decideRetention(doc, currentVersion);
    if (!decision.eligible) continue;

    // M3: same guard as approve/obsolete above.
    if (decision.action === "deleted") {
      await db.update(documents).set({ isDeleted: true, updatedAt: new Date() }).where(and(eq(documents.id, doc.id)));
    } else {
      await db.update(documents).set({ retentionState: "archived", updatedAt: new Date() }).where(and(eq(documents.id, doc.id)));
    }
    results.push({ documentId: doc.id, action: decision.action! });

    await recordAuditTrail(db, {
      entityType: "Document",
      entityId: doc.id,
      action: "update",
      changes: { action: "retention", retentionAction: doc.retentionAction },
      performedBy: req.user?.id,
    });
  }

  res.json({ processed: results.length, results });
});

/**
 * On-demand, single-document version of applyRetentionHandler — real, new
 * (see Phase 6's endpoint list: "archive"). Same eligibility rule as the
 * bulk sweep, just for one obsolete document instead of waiting for someone
 * to run the company-wide pass.
 */
export const archiveHandler = asyncHandler(async (req: Request, res: Response) => {
  const documentId = Number(req.params.id);
  const [doc] = await req.db!.select().from(documents).where(and(eq(documents.id, documentId)));
  if (!doc) throw AppError.notFound("Document");

  const [currentVersion] = await req
    .db!.select()
    .from(documentVersions)
    .where(and(eq(documentVersions.documentId, doc.id), eq(documentVersions.version, doc.currentVersion)));

  const decision = decideRetention(doc, currentVersion);
  if (!decision.eligible) throw AppError.badRequest(`Cannot archive this document: ${decision.reason}`);

  // Same M3 defense-in-depth fix as applyRetentionHandler above.
  const [updated] =
    decision.action === "deleted"
      ? await req.db!.update(documents).set({ isDeleted: true, updatedAt: new Date() }).where(and(eq(documents.id, documentId))).returning()
      : await req.db!.update(documents).set({ retentionState: "archived", updatedAt: new Date() }).where(and(eq(documents.id, documentId))).returning();

  await recordAuditTrail(req.db!, {
    entityType: "Document",
    entityId: documentId,
    action: "update",
    changes: { action: "retention", retentionAction: doc.retentionAction },
    performedBy: req.user?.id,
  });

  res.json(updated);
});
