import type { Request, Response } from "express";
import { mkdir, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { documents, documentVersions, type Document, type DocumentVersion } from "../../drizzle/schema/documents.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";
import { env } from "../../config/env.js";
import type { TenantDb } from "../../lib/tenantScope.js";

export const baseHandlers = crudFactory(documents, { entityName: "Document", idColumn: "id", softDelete: true });

interface AddVersionInput {
  fileUrl: string;
  changeNotes?: string;
}

/**
 * Shared by the JSON path (addVersionHandler, fileUrl already known) and the
 * multipart upload path (uploadVersionHandler, fileUrl is the just-saved
 * file's path) — one place that bumps currentVersion, writes the version
 * row, and records the audit entry, so the two can't diverge.
 */
async function createDocumentVersionRow(db: TenantDb, tenantId: number, documentId: number, input: AddVersionInput, userId?: number) {
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.tenantId, tenantId)));
  if (!doc) throw AppError.notFound("Document");

  const nextVersion = doc.currentVersion + 1;
  const [version] = await db
    .insert(documentVersions)
    .values({ tenantId, documentId, version: nextVersion, fileUrl: input.fileUrl, changeNotes: input.changeNotes, createdBy: userId })
    .returning();
  if (!version) throw new AppError("Failed to record document version", 500);

  await db
    .update(documents)
    .set({ currentVersion: nextVersion, status: "in_review", updatedAt: new Date() })
    .where(and(eq(documents.id, documentId), eq(documents.tenantId, tenantId)));

  await recordAuditTrail(db, {
    tenantId,
    entityType: "Document",
    entityId: documentId,
    action: "update",
    changes: { action: "revise", versionId: version.id, version: nextVersion, changeNotes: input.changeNotes },
    performedBy: userId,
  });

  return version;
}

export const addVersionHandler = asyncHandler(async (req: Request, res: Response) => {
  const version = await createDocumentVersionRow(req.db!, req.tenantId!, Number(req.params.id), req.body, req.user?.id);
  res.status(201).json(version);
});

/** Same as addVersionHandler, but the file comes from a real upload instead of an already-hosted fileUrl. */
export const uploadVersionHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const documentId = Number(req.params.id);
  const file = req.file;
  if (!file) throw AppError.badRequest("No file uploaded");
  if (file.mimetype !== "application/pdf") throw AppError.badRequest("Only PDF files are accepted");

  const dir = `${env.STORAGE_LOCAL_PATH}/tenants/${tenantId}/forms/custom/document-versions`;
  await mkdir(dir, { recursive: true });
  const path = `${dir}/${documentId}-${Date.now()}.pdf`;
  await writeFile(path, file.buffer);

  const version = await createDocumentVersionRow(req.db!, tenantId, documentId, { fileUrl: path, changeNotes: req.body.changeNotes }, req.user?.id);
  res.status(201).json(version);
});

export const approveHandler = asyncHandler(async (req: Request, res: Response) => {
  const documentId = Number(req.params.id);
  const tenantId = req.tenantId!;
  const { approvalNotes } = req.body as { approvalNotes?: string };

  const [doc] = await req.db!.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.tenantId, tenantId)));
  if (!doc) throw AppError.notFound("Document");

  await req
    .db!.update(documentVersions)
    .set({ approvedBy: req.user?.id, approvedAt: new Date(), approvalNotes })
    .where(and(eq(documentVersions.documentId, documentId), eq(documentVersions.tenantId, tenantId), eq(documentVersions.version, doc.currentVersion)));

  // Full-System Audit finding M3 — the SELECT above already scoped this
  // document to the caller's own tenant, so this couldn't actually approve
  // someone else's document, but the UPDATE itself dropped the tenantId
  // predicate every other module's writes keep as defense-in-depth (RLS is
  // the second, DB-level layer — see the README's "two independent,
  // deliberately redundant layers" section; this is the first).
  const [updated] = await req.db!.update(documents).set({ status: "approved", updatedAt: new Date() }).where(and(eq(documents.id, documentId), eq(documents.tenantId, tenantId))).returning();

  // "approve" isn't in audit_trail's fixed action enum (create/update/delete/
  // status_change) — this is exactly what status_change means, so use it.
  await recordAuditTrail(req.db!, {
    tenantId,
    entityType: "Document",
    entityId: documentId,
    action: "status_change",
    changes: { action: "approve", version: doc.currentVersion, approvalNotes, status: "approved" },
    performedBy: req.user?.id,
  });
  // Phase 9 — Document Revision was the one status-changing module with no
  // publishEvent(WORKFLOW_STREAM, ...) call at all (confirmed by the Phase
  // 9 workflow-engine research), so no workflow definition could ever react
  // to a document being approved. Additive only — the approval logic above
  // is unchanged.
  await publishEvent(WORKFLOW_STREAM, { tenantId, module: "documents", event: "approved", entityId: documentId });

  res.json(updated);
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
  const tenantId = req.tenantId!;

  const [doc] = await req.db!.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.tenantId, tenantId)));
  if (!doc) throw AppError.notFound("Document");
  if (doc.status !== "approved") {
    throw AppError.badRequest(`Cannot obsolete a document from status "${doc.status}" — must be "approved".`);
  }

  // Same M3 defense-in-depth fix as approveHandler above.
  const [updated] = await req.db!.update(documents).set({ status: "obsolete", updatedAt: new Date() }).where(and(eq(documents.id, documentId), eq(documents.tenantId, tenantId))).returning();

  await recordAuditTrail(req.db!, {
    tenantId,
    entityType: "Document",
    entityId: documentId,
    action: "status_change",
    changes: { action: "obsolete", status: "obsolete" },
    performedBy: req.user?.id,
  });
  await publishEvent(WORKFLOW_STREAM, { tenantId, module: "documents", event: "obsolete", entityId: documentId });

  res.json(updated);
});

/**
 * Streams a version's file back — only works for versions uploaded through
 * uploadVersionHandler (a real local path). A version created via the JSON
 * `POST .../version` endpoint with an already-hosted fileUrl is just linked
 * to directly by the frontend instead.
 */
export const downloadVersionHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const versionId = Number(req.params.versionId);

  const [version] = await req.db!.select().from(documentVersions).where(and(eq(documentVersions.id, versionId), eq(documentVersions.tenantId, tenantId)));
  if (!version) throw AppError.notFound("Document version");
  if (!version.fileUrl || /^https?:\/\//i.test(version.fileUrl) || !existsSync(version.fileUrl)) {
    throw AppError.notFound("Uploaded file for this version");
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="document-${version.documentId}-rev${version.version}.pdf"`);
  createReadStream(version.fileUrl).pipe(res);
});

export const historyHandler = asyncHandler(async (req: Request, res: Response) => {
  const versions = await req
    .db!.select()
    .from(documentVersions)
    .where(and(eq(documentVersions.documentId, Number(req.params.id)), eq(documentVersions.tenantId, req.tenantId!)));
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
  const rows = await req.db!.select().from(documents).where(eq(documents.tenantId, req.tenantId!));
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
 * active document" (see approveHandler above).
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

/** Runs retention synchronously for every obsolete, aged-out document in the tenant — no worker, triggered on demand (POST /documents/retention/apply). */
export const applyRetentionHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = req.db!;
  const obsolete = await db.select().from(documents).where(and(eq(documents.tenantId, tenantId), eq(documents.status, "obsolete")));

  const results: { documentId: number; action: string }[] = [];

  for (const doc of obsolete) {
    const [currentVersion] = await db
      .select()
      .from(documentVersions)
      .where(and(eq(documentVersions.documentId, doc.id), eq(documentVersions.tenantId, tenantId), eq(documentVersions.version, doc.currentVersion)));

    const decision = decideRetention(doc, currentVersion);
    if (!decision.eligible) continue;

    // M3: same defense-in-depth tenantId predicate as approve/obsolete above —
    // `obsolete` was already loaded scoped to this tenant, so this doesn't
    // change which documents are affected, only matches convention.
    if (decision.action === "deleted") {
      await db.update(documents).set({ isDeleted: true, updatedAt: new Date() }).where(and(eq(documents.id, doc.id), eq(documents.tenantId, tenantId)));
    } else {
      await db.update(documents).set({ retentionState: "archived", updatedAt: new Date() }).where(and(eq(documents.id, doc.id), eq(documents.tenantId, tenantId)));
    }
    results.push({ documentId: doc.id, action: decision.action! });

    await recordAuditTrail(db, {
      tenantId,
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
 * to run the tenant-wide pass.
 */
export const archiveHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const documentId = Number(req.params.id);
  const [doc] = await req.db!.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.tenantId, tenantId)));
  if (!doc) throw AppError.notFound("Document");

  const [currentVersion] = await req
    .db!.select()
    .from(documentVersions)
    .where(and(eq(documentVersions.documentId, doc.id), eq(documentVersions.tenantId, tenantId), eq(documentVersions.version, doc.currentVersion)));

  const decision = decideRetention(doc, currentVersion);
  if (!decision.eligible) throw AppError.badRequest(`Cannot archive this document: ${decision.reason}`);

  // Same M3 defense-in-depth fix as applyRetentionHandler above.
  const [updated] =
    decision.action === "deleted"
      ? await req.db!.update(documents).set({ isDeleted: true, updatedAt: new Date() }).where(and(eq(documents.id, documentId), eq(documents.tenantId, tenantId))).returning()
      : await req.db!.update(documents).set({ retentionState: "archived", updatedAt: new Date() }).where(and(eq(documents.id, documentId), eq(documents.tenantId, tenantId))).returning();

  await recordAuditTrail(req.db!, {
    tenantId,
    entityType: "Document",
    entityId: documentId,
    action: "update",
    changes: { action: "retention", retentionAction: doc.retentionAction },
    performedBy: req.user?.id,
  });

  res.json(updated);
});
