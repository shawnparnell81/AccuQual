import type { Request, Response } from "express";
import { mkdir, writeFile } from "node:fs/promises";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  supplierOnboardingDocuments,
  supplierDocuments,
  supplierPpapSubmissions,
  supplierCorrectiveActions,
  supplier8dResponses,
  supplierMessages,
  type StoredFile,
} from "../../drizzle/schema/supplierPortal.js";
import { suppliers, supplierScorecards } from "../../drizzle/schema/supplier.js";
import { rma } from "../../drizzle/schema/rma.js";
import { warrantyClaims } from "../../drizzle/schema/warranty.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { capa } from "../../drizzle/schema/capa.js";
import { scarForms } from "../../drizzle/schema/scarForms.js";
import { notificationLog } from "../../drizzle/schema/notifications.js";
import { qualityInspectionReports } from "../../drizzle/schema/qualityInspectionReports.js";
import { inventoryLots } from "../../drizzle/schema/inventoryLots.js";
import { erpReceivingLineItems } from "../../drizzle/schema/erp.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { env } from "../../config/env.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";
import { sendEmail } from "../notifications/notification.service.js";
import { getSupplierNcrIds, getSupplierCapaIds } from "./supplierLinkage.js";
import { getSupplierQualityFactors, getSupplierHealth, getSupplierRiskScoreWithTrend, exportSupplierScorecard } from "../supplier/supplier.qualityRisk.js";

/**
 * The one real rule this whole module exists to enforce: an external
 * supplier login (roleName:"supplier") may NEVER touch another supplier's
 * data, no matter what a request body/query claims. It always resolves to
 * `req.user.supplierId` (set at login — see auth.service.ts), never to a
 * client-supplied value. Internal staff instead pick a target supplier
 * explicitly (body.supplierId, or ?supplierId= for a list/filter) — omitted
 * on a list means "every supplier", the normal internal-review view.
 */
function resolveSupplierScope(req: Request, requestedSupplierId?: number | string): number {
  if (req.user?.roleName === "supplier") {
    if (!req.user.supplierId) throw AppError.forbidden("This supplier login is not linked to a real supplier record");
    return req.user.supplierId;
  }
  const id = requestedSupplierId !== undefined ? Number(requestedSupplierId) : undefined;
  if (!id) throw AppError.badRequest("supplierId is required");
  return id;
}

/** Same as resolveSupplierScope, but for a list/GET where internal staff may omit it entirely to see every supplier. */
function resolveSupplierFilter(req: Request): number | null {
  if (req.user?.roleName === "supplier") {
    if (!req.user.supplierId) throw AppError.forbidden("This supplier login is not linked to a real supplier record");
    return req.user.supplierId;
  }
  const q = req.query.supplierId as string | undefined;
  return q ? Number(q) : null;
}

function isInternalStaff(req: Request): boolean {
  return req.user?.roleName !== "supplier";
}

/** Reviewing/approving a supplier's submission is Quality/Purchasing-or-admin only — Engineering's read-only PERMISSION_MATRIX.supplier_portal level already blocks it at the router; a supplier account is never internal staff at all. */
function assertReviewer(req: Request) {
  const role = req.user?.roleName;
  if (role === "admin" || role === "platform_admin") return;
  const department = req.user?.department;
  if (!isInternalStaff(req) || !department || !["quality", "purchasing"].includes(department)) {
    throw AppError.forbidden("Only Quality or Purchasing may review a supplier submission");
  }
}

/**
 * Sprint 2 fix (accuqual-implementation-sequencing.md) — review8dHandler and
 * reviewCorrectiveActionHandler previously wrote `status` straight through
 * with no fetch-and-compare against the current value at all, so a reviewer
 * could "review" the same submission twice, flip an already-accepted
 * response straight to rejected, etc. The real, live UI (Supplier8DForm.tsx/
 * SupplierCARForm.tsx) only ever shows Accept/Reject buttons while a
 * submission is "submitted" or "under_review" — once it's "accepted" or
 * "rejected" it's terminal — so this mirrors that real behavior server-side
 * instead of inventing a stricter one-way sequence the actual product
 * doesn't have (PPAP's own review flow, which does use a distinct
 * "under_review" action, is a separate, out-of-scope handler).
 */
const RESPONSE_TERMINAL_STATUSES = new Set(["accepted", "rejected"]);
function assertReviewTransition(currentStatus: string, nextStatus: string) {
  if (RESPONSE_TERMINAL_STATUSES.has(currentStatus)) {
    throw AppError.badRequest(`Cannot review a submission that is already "${currentStatus}".`);
  }
  if (currentStatus === nextStatus) {
    throw AppError.badRequest(`Submission is already "${currentStatus}".`);
  }
}

async function assertSupplierExists(req: Request, supplierId: number) {
  const [row] = await req.db!.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, supplierId)));
  if (!row) throw AppError.badRequest(`Supplier #${supplierId} not found`);
}

async function storeSupplierFile(req: Request, subdir: string, file: Express.Multer.File): Promise<StoredFile> {
  const dir = `${env.STORAGE_LOCAL_PATH}/supplier-portal/${subdir}`;
  await mkdir(dir, { recursive: true });
  const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = `${dir}/${Date.now()}-${safeName}`;
  await writeFile(filePath, file.buffer);
  return { fileName: file.originalname, filePath, mimeType: file.mimetype, fileSize: file.size, uploadedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export const uploadOnboardingDocumentHandler = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) throw AppError.badRequest("No file uploaded");
  const supplierId = resolveSupplierScope(req, req.body.supplierId);
  await assertSupplierExists(req, supplierId);
  const documentType = req.body.documentType as string;
  const stored = await storeSupplierFile(req, "onboarding", file);

  const [created] = await req
    .db!.insert(supplierOnboardingDocuments)
    .values({
      supplierId,
      documentType,
      fileName: stored.fileName,
      filePath: stored.filePath,
      mimeType: stored.mimeType,
      fileSize: stored.fileSize,
      uploadedByUserId: req.user?.id,
    })
    .returning();

  await recordAuditTrail(req.db!, {
    entityType: "SupplierOnboardingDocument",
    entityId: created!.id,
    action: "create",
    changes: { supplierId, documentType, fileName: file.originalname },
    performedBy: req.user?.id,
  });
  res.status(201).json(created);
});

/** GET /supplier-portal/onboarding/status — the latest row per documentType (resubmission inserts a new row rather than overwriting — see the schema comment), so a rejected-then-resubmitted document shows only its current state. */
export const onboardingStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = resolveSupplierFilter(req);
  const conditions = [];
  if (supplierId) conditions.push(eq(supplierOnboardingDocuments.supplierId, supplierId));

  const rows = await req.db!.select().from(supplierOnboardingDocuments).where(and(...conditions)).orderBy(desc(supplierOnboardingDocuments.createdAt));
  const latestByType = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.supplierId}:${row.documentType}`;
    if (!latestByType.has(key)) latestByType.set(key, row);
  }
  res.json([...latestByType.values()]);
});

export const reviewOnboardingDocumentHandler = asyncHandler(async (req: Request, res: Response) => {
  assertReviewer(req);
  const id = Number(req.params.id);
  const { status, reviewNotes } = req.body as { status: string; reviewNotes?: string };
  const [updated] = await req
    .db!.update(supplierOnboardingDocuments)
    .set({ status, reviewNotes, reviewedByUserId: req.user?.id, updatedAt: new Date() })
    .where(and(eq(supplierOnboardingDocuments.id, id)))
    .returning();
  if (!updated) throw AppError.notFound("SupplierOnboardingDocument");

  await recordAuditTrail(req.db!, { entityType: "SupplierOnboardingDocument", entityId: id, action: "status_change", changes: { status, reviewNotes }, performedBy: req.user?.id });
  res.json(updated);
});

// ---------------------------------------------------------------------------
// Ongoing document management
// ---------------------------------------------------------------------------

export const uploadSupplierDocumentHandler = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) throw AppError.badRequest("No file uploaded");
  const supplierId = resolveSupplierScope(req, req.body.supplierId);
  await assertSupplierExists(req, supplierId);
  const { name, category } = req.body as { name: string; category?: string };
  const stored = await storeSupplierFile(req, "documents", file);

  const [created] = await req
    .db!.insert(supplierDocuments)
    .values({ supplierId, name, category, fileName: stored.fileName, filePath: stored.filePath, mimeType: stored.mimeType, fileSize: stored.fileSize, uploadedByUserId: req.user?.id })
    .returning();

  await recordAuditTrail(req.db!, { entityType: "SupplierDocument", entityId: created!.id, action: "create", changes: { supplierId, name, category }, performedBy: req.user?.id });
  res.status(201).json(created);
});

export const listSupplierDocumentsHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = resolveSupplierFilter(req);
  const conditions = [];
  if (supplierId) conditions.push(eq(supplierDocuments.supplierId, supplierId));
  const rows = await req.db!.select().from(supplierDocuments).where(and(...conditions)).orderBy(desc(supplierDocuments.createdAt));
  res.json(rows);
});

// ---------------------------------------------------------------------------
// PPAP submissions
// ---------------------------------------------------------------------------

export const submitPpapHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = resolveSupplierScope(req, req.body.supplierId);
  await assertSupplierExists(req, supplierId);
  const { level, partNumber, description } = req.body as { level: number; partNumber?: string; description?: string };

  const [created] = await req
    .db!.insert(supplierPpapSubmissions)
    .values({ supplierId, level, partNumber, description, submittedByUserId: req.user?.id })
    .returning();

  await recordAuditTrail(req.db!, { entityType: "SupplierPpapSubmission", entityId: created!.id, action: "create", changes: { supplierId, level, partNumber }, performedBy: req.user?.id });
  res.status(201).json(created);
});

/** POST /supplier-portal/ppap/:id/documents — attaches one named PPAP element (PSW/DFMEA/etc.) to an existing submission; a submission is inherently multi-file (see the schema comment). */
export const uploadPpapDocumentHandler = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) throw AppError.badRequest("No file uploaded");
  const id = Number(req.params.id);
  const documentType = req.body.documentType as string;
  const [submission] = await req.db!.select().from(supplierPpapSubmissions).where(and(eq(supplierPpapSubmissions.id, id)));
  if (!submission) throw AppError.notFound("SupplierPpapSubmission");
  if (req.user?.roleName === "supplier" && submission.supplierId !== req.user.supplierId) throw AppError.forbidden("Not your submission");

  const stored = await storeSupplierFile(req, "ppap", file);
  const nextDocuments = { ...(submission.documents ?? {}), [documentType]: stored };
  const [updated] = await req.db!.update(supplierPpapSubmissions).set({ documents: nextDocuments, updatedAt: new Date() }).where(eq(supplierPpapSubmissions.id, id)).returning();

  await recordAuditTrail(req.db!, { entityType: "SupplierPpapSubmission", entityId: id, action: "update", changes: { addedDocument: documentType, fileName: file.originalname }, performedBy: req.user?.id });
  res.json(updated);
});

/** GET /supplier-portal/ppap/status — list form (a supplier's own submissions, or every submission for internal staff, optionally filtered). */
export const ppapStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = resolveSupplierFilter(req);
  const conditions = [];
  if (supplierId) conditions.push(eq(supplierPpapSubmissions.supplierId, supplierId));
  const rows = await req.db!.select().from(supplierPpapSubmissions).where(and(...conditions)).orderBy(desc(supplierPpapSubmissions.createdAt));
  res.json(rows);
});

export const reviewPpapHandler = asyncHandler(async (req: Request, res: Response) => {
  assertReviewer(req);
  const id = Number(req.params.id);
  const { status, reviewNotes } = req.body as { status: string; reviewNotes?: string };
  const [updated] = await req
    .db!.update(supplierPpapSubmissions)
    .set({ status, reviewNotes, reviewedByUserId: req.user?.id, updatedAt: new Date() })
    .where(and(eq(supplierPpapSubmissions.id, id)))
    .returning();
  if (!updated) throw AppError.notFound("SupplierPpapSubmission");

  await recordAuditTrail(req.db!, { entityType: "SupplierPpapSubmission", entityId: id, action: "status_change", changes: { status, reviewNotes }, performedBy: req.user?.id });
  res.json(updated);
});

// ---------------------------------------------------------------------------
// Corrective Action responses
// ---------------------------------------------------------------------------

export const respondCorrectiveActionHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = resolveSupplierScope(req, req.body.supplierId);
  await assertSupplierExists(req, supplierId);
  const { linkedNcrId, linkedCapaId, problemDescription, containment, rootCause, correctiveAction, preventiveAction, verification } = req.body as Record<string, string | number | undefined>;

  const [created] = await req
    .db!.insert(supplierCorrectiveActions)
    .values({
      supplierId,
      linkedNcrId: linkedNcrId ? Number(linkedNcrId) : undefined,
      linkedCapaId: linkedCapaId ? Number(linkedCapaId) : undefined,
      data: { problemDescription, containment, rootCause, correctiveAction, preventiveAction, verification } as Record<string, string | undefined>,
      submittedByUserId: req.user?.id,
    })
    .returning();

  await recordAuditTrail(req.db!, { entityType: "SupplierCorrectiveAction", entityId: created!.id, action: "create", changes: { supplierId, linkedNcrId, linkedCapaId }, performedBy: req.user?.id });
  res.status(201).json(created);
});

export const listCorrectiveActionsHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = resolveSupplierFilter(req);
  const conditions = [];
  if (supplierId) conditions.push(eq(supplierCorrectiveActions.supplierId, supplierId));
  const rows = await req.db!.select().from(supplierCorrectiveActions).where(and(...conditions)).orderBy(desc(supplierCorrectiveActions.createdAt));
  res.json(rows);
});

export const reviewCorrectiveActionHandler = asyncHandler(async (req: Request, res: Response) => {
  assertReviewer(req);
  const id = Number(req.params.id);
  const { status, reviewNotes } = req.body as { status: string; reviewNotes?: string };

  const [existing] = await req.db!.select({ status: supplierCorrectiveActions.status }).from(supplierCorrectiveActions).where(and(eq(supplierCorrectiveActions.id, id)));
  if (!existing) throw AppError.notFound("SupplierCorrectiveAction");
  assertReviewTransition(existing.status, status);

  const [updated] = await req
    .db!.update(supplierCorrectiveActions)
    .set({ status, reviewNotes, reviewedByUserId: req.user?.id, updatedAt: new Date() })
    .where(and(eq(supplierCorrectiveActions.id, id)))
    .returning();
  if (!updated) throw AppError.notFound("SupplierCorrectiveAction");

  await recordAuditTrail(req.db!, { entityType: "SupplierCorrectiveAction", entityId: id, action: "status_change", changes: { status, reviewNotes }, performedBy: req.user?.id });
  // Phase 9 — the Supplier Corrective Action review had no workflow event
  // at all before this (confirmed absent), so no workflow definition could
  // react to it. Additive only — the review logic above is unchanged.
  await publishEvent(WORKFLOW_STREAM, { module: "supplier_car", event: status, entityId: id, supplierId: updated!.supplierId });
  res.json(updated);
});

// ---------------------------------------------------------------------------
// 8D responses
// ---------------------------------------------------------------------------

export const submit8dHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = resolveSupplierScope(req, req.body.supplierId);
  await assertSupplierExists(req, supplierId);
  const { linkedNcrId, linkedEightDId, d1_team, d2_problem, d3_containment, d4_rootCause, d5_correctiveAction, d6_validation, d7_prevention, d8_closure } = req.body as Record<
    string,
    string | number | undefined
  >;

  const [created] = await req
    .db!.insert(supplier8dResponses)
    .values({
      supplierId,
      linkedNcrId: linkedNcrId ? Number(linkedNcrId) : undefined,
      linkedEightDId: linkedEightDId ? Number(linkedEightDId) : undefined,
      data: { d1_team, d2_problem, d3_containment, d4_rootCause, d5_correctiveAction, d6_validation, d7_prevention, d8_closure } as Record<string, string | undefined>,
      submittedByUserId: req.user?.id,
    })
    .returning();

  await recordAuditTrail(req.db!, { entityType: "Supplier8dResponse", entityId: created!.id, action: "create", changes: { supplierId, linkedNcrId, linkedEightDId }, performedBy: req.user?.id });
  res.status(201).json(created);
});

export const eightDStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = resolveSupplierFilter(req);
  const conditions = [];
  if (supplierId) conditions.push(eq(supplier8dResponses.supplierId, supplierId));
  const rows = await req.db!.select().from(supplier8dResponses).where(and(...conditions)).orderBy(desc(supplier8dResponses.createdAt));
  res.json(rows);
});

export const review8dHandler = asyncHandler(async (req: Request, res: Response) => {
  assertReviewer(req);
  const id = Number(req.params.id);
  const { status, reviewNotes } = req.body as { status: string; reviewNotes?: string };

  const [existing] = await req.db!.select({ status: supplier8dResponses.status }).from(supplier8dResponses).where(and(eq(supplier8dResponses.id, id)));
  if (!existing) throw AppError.notFound("Supplier8dResponse");
  assertReviewTransition(existing.status, status);

  const [updated] = await req
    .db!.update(supplier8dResponses)
    .set({ status, reviewNotes, reviewedByUserId: req.user?.id, updatedAt: new Date() })
    .where(and(eq(supplier8dResponses.id, id)))
    .returning();
  if (!updated) throw AppError.notFound("Supplier8dResponse");

  await recordAuditTrail(req.db!, { entityType: "Supplier8dResponse", entityId: id, action: "status_change", changes: { status, reviewNotes }, performedBy: req.user?.id });
  res.json(updated);
});

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export const sendMessageHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = resolveSupplierScope(req, req.body.supplierId);
  await assertSupplierExists(req, supplierId);
  const { body, threadKey, category, aiDrafted } = req.body as { body: string; threadKey?: string; category?: string; aiDrafted?: boolean };
  const senderRole = req.user?.roleName === "supplier" ? "supplier" : "internal";

  const [created] = await req
    .db!.insert(supplierMessages)
    .values({ supplierId, threadKey: threadKey || "general", senderRole, senderUserId: req.user?.id, body, category: category || "message", aiDrafted: aiDrafted === true })
    .returning();

  await recordAuditTrail(req.db!, { entityType: "SupplierMessage", entityId: created!.id, action: "create", changes: { supplierId, senderRole, threadKey: created!.threadKey, category: created!.category, aiDrafted: created!.aiDrafted }, performedBy: req.user?.id });
  res.status(201).json(created);
});

/**
 * Phase 5 — "Ensure email templates integrate with Phase 1 email
 * infrastructure": internal-staff-only (a supplier login has no reason to
 * email itself). Sends a REAL email via notification.service.ts's
 * sendEmail() — the same transport tenant onboarding/password reset use —
 * to the supplier's own contactEmail, not just an in-app portal message
 * (a supplier may not be logged into the portal to see that). Logs a real
 * notification_log row (same shape every other real notification leaves)
 * and also mirrors the content into the in-app thread via supplierMessages,
 * so the full exchange stays visible in one place either way it was sent.
 */
export const sendMessageEmailHandler = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.roleName === "supplier") throw AppError.forbidden("Only internal staff can send a supplier email");
  const supplierId = resolveSupplierScope(req, req.body.supplierId);
  const { subject, body, threadKey, category, aiDrafted } = req.body as { subject: string; body: string; threadKey?: string; category?: string; aiDrafted?: boolean };

  const [supplier] = await req.db!.select().from(suppliers).where(and(eq(suppliers.id, supplierId)));
  if (!supplier) throw AppError.notFound("Supplier");
  if (!supplier.contactEmail) throw AppError.badRequest("This supplier has no contact email on file — add one before sending an email.");

  const status = await sendEmail({ to: supplier.contactEmail, subject, body });
  await req.db!.insert(notificationLog).values({ channel: "email", recipient: supplier.contactEmail, subject, body, status, relatedEntityType: "Supplier", relatedEntityId: supplierId });

  const [created] = await req
    .db!.insert(supplierMessages)
    .values({
      supplierId,
      threadKey: threadKey || "general",
      senderRole: "internal",
      senderUserId: req.user?.id,
      body: `[Emailed — ${subject}]\n\n${body}`,
      category: category || "message",
      aiDrafted: aiDrafted === true,
    })
    .returning();

  await recordAuditTrail(req.db!, {
    entityType: "SupplierMessage",
    entityId: created!.id,
    action: "create",
    changes: { supplierId, senderRole: "internal", channel: "email", recipient: supplier.contactEmail, subject, emailStatus: status, category: created!.category, aiDrafted: created!.aiDrafted },
    performedBy: req.user?.id,
  });

  res.status(201).json({ ...created, emailStatus: status });
});

/** GET /supplier-portal/messages/thread — marks every message NOT sent by the reading party as read (a real read receipt, not just a listing). */
export const getThreadHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = resolveSupplierScope(req, req.query.supplierId as string | undefined);
  const threadKey = (req.query.threadKey as string | undefined) || "general";
  const readerRole = req.user?.roleName === "supplier" ? "supplier" : "internal";
  const otherRole = readerRole === "supplier" ? "internal" : "supplier";

  await req
    .db!.update(supplierMessages)
    .set({ readAt: new Date() })
    .where(and(eq(supplierMessages.supplierId, supplierId), eq(supplierMessages.threadKey, threadKey), eq(supplierMessages.senderRole, otherRole), isNull(supplierMessages.readAt)));

  const rows = await req
    .db!.select()
    .from(supplierMessages)
    .where(and(eq(supplierMessages.supplierId, supplierId), eq(supplierMessages.threadKey, threadKey)))
    .orderBy(supplierMessages.createdAt);
  res.json(rows);
});

// ---------------------------------------------------------------------------
// Scorecard + performance (reuses the existing real supplierScorecards table
// and supplier.performance.ts's own analytics — see that module's own
// comment; this is a read-only self-service view onto data that already has
// a real home, not a second scoring system).
// ---------------------------------------------------------------------------

export const scorecardHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = resolveSupplierScope(req, req.query.supplierId as string | undefined);
  const rows = await req.db!.select().from(supplierScorecards).where(and(eq(supplierScorecards.supplierId, supplierId))).orderBy(desc(supplierScorecards.createdAt));
  res.json(rows);
});

export const performanceHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = resolveSupplierScope(req, req.query.supplierId as string | undefined);
  const [supplier] = await req.db!.select().from(suppliers).where(and(eq(suppliers.id, supplierId)));
  if (!supplier) throw AppError.notFound("Supplier");

  const openCorrectiveActions = await req.db!.select().from(supplierCorrectiveActions).where(and(eq(supplierCorrectiveActions.supplierId, supplierId)));
  const ppapSubmissions = await req.db!.select().from(supplierPpapSubmissions).where(and(eq(supplierPpapSubmissions.supplierId, supplierId)));
  const approvedPpap = ppapSubmissions.filter((p) => p.status === "approved").length;

  res.json({
    supplier: { id: supplier.id, name: supplier.name, status: supplier.status, riskLevel: supplier.riskLevel },
    correctiveActionCount: openCorrectiveActions.length,
    correctiveActionAcceptedCount: openCorrectiveActions.filter((c) => c.status === "accepted").length,
    ppapSubmissionCount: ppapSubmissions.length,
    ppapApprovalRate: ppapSubmissions.length > 0 ? Number(((approvedPpap / ppapSubmissions.length) * 100).toFixed(1)) : null,
  });
});

// ---------------------------------------------------------------------------
// NCR/CAPA visibility — derived from existing real links (RMA/warranty
// claims tied to this supplier, plus any corrective-action/8D response this
// supplier already submitted against one), NOT a new supplierId column on
// ncr/capa themselves (no workflow/schema changes to those existing
// modules, per the brief).
// ---------------------------------------------------------------------------

export const supplierNcrListHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = resolveSupplierScope(req, req.query.supplierId as string | undefined);
  const ncrIds = await getSupplierNcrIds(req.db!, supplierId);
  if (ncrIds.length === 0) return res.json([]);

  const rows = await req.db!.select().from(ncr).where(and(inArray(ncr.id, ncrIds)));
  res.json(rows);
});

export const supplierCapaListHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = resolveSupplierScope(req, req.query.supplierId as string | undefined);
  const capaIds = await getSupplierCapaIds(req.db!, supplierId);
  if (capaIds.length === 0) return res.json([]);

  const rows = await req.db!.select().from(capa).where(and(inArray(capa.id, capaIds)));
  res.json(rows);
});

// ---------------------------------------------------------------------------
// Phase 7 — RMA / Warranty / SCAR visibility. Unlike NCR/CAPA above, these
// three DO carry a real supplierId FK, so no join-derivation is needed — but
// their own routers (rma/warranty/scar-forms) are gated by
// requireDepartmentAccess, which a "supplier" login (department: null) can
// never pass. These thin wrapper endpoints reuse each module's own schema
// directly, gated instead by requireSupplierPortalAccess +
// resolveSupplierScope, exactly like every other read in this file.
// ---------------------------------------------------------------------------

export const supplierRmaListHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = resolveSupplierScope(req, req.query.supplierId as string | undefined);
  const rows = await req.db!.select().from(rma).where(and(eq(rma.supplierId, supplierId))).orderBy(desc(rma.createdAt));
  res.json(rows);
});

export const supplierWarrantyListHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = resolveSupplierScope(req, req.query.supplierId as string | undefined);
  const rows = await req.db!.select().from(warrantyClaims).where(and(eq(warrantyClaims.supplierId, supplierId))).orderBy(desc(warrantyClaims.createdAt));
  res.json(rows);
});

export const supplierScarListHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = resolveSupplierScope(req, req.query.supplierId as string | undefined);
  const rows = await req.db!.select().from(scarForms).where(and(eq(scarForms.supplierId, supplierId))).orderBy(desc(scarForms.createdAt));
  res.json(rows);
});

/**
 * GET /supplier-portal/inspections/list — Phase 8 task 3's "supplier-facing
 * visibility: ... inspection notes". Reads the real supplierId FK added
 * this phase directly (a real join, unlike NCR/CAPA's derived-link
 * pattern — an inspection report either names this supplier or it
 * doesn't). Read-only: a supplier never edits an inspection report.
 */
export const supplierInspectionListHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = resolveSupplierScope(req, req.query.supplierId as string | undefined);
  const rows = await req.db!.select().from(qualityInspectionReports).where(and(eq(qualityInspectionReports.supplierId, supplierId))).orderBy(desc(qualityInspectionReports.createdAt));
  res.json(rows);
});

/**
 * GET /supplier-portal/lots/list — Phase 8 task 3's "supplier-facing
 * visibility: accepted lots, rejected lots". Reads real inventory_lots
 * rows for this supplier, joined live to the originating receiving line
 * item's own disposition status (a lot has no disposition of its own — the
 * receiving line item it came from does, see erp.ts's schema comment) so a
 * supplier can see which of their shipments passed or failed inspection.
 */
export const supplierLotListHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = resolveSupplierScope(req, req.query.supplierId as string | undefined);
  const lots = await req.db!.select().from(inventoryLots).where(and(eq(inventoryLots.supplierId, supplierId))).orderBy(desc(inventoryLots.createdAt));
  const lineItemIds = lots.map((l) => l.receivingLineItemId).filter((id): id is number => id !== null);
  const lineItems = lineItemIds.length > 0 ? await req.db!.select({ id: erpReceivingLineItems.id, status: erpReceivingLineItems.status }).from(erpReceivingLineItems).where(inArray(erpReceivingLineItems.id, lineItemIds)) : [];
  const statusByLineItem = new Map(lineItems.map((l) => [l.id, l.status]));
  res.json(lots.map((l) => ({ ...l, receivingStatus: l.receivingLineItemId ? (statusByLineItem.get(l.receivingLineItemId) ?? null) : null })));
});

/**
 * GET /supplier-portal/kpis — Phase 7 task 1's KPI strip (NCR count, CAPA
 * count, on-time delivery %, defect rate, open corrective actions), and
 * task 8's health indicators (last login / last upload / last
 * communication / open action count) in one call, so the portal dashboard
 * and the internal Supplier Detail page can both render the same numbers
 * from the same source. Delegates every actual computation to
 * supplier.qualityRisk.ts's getSupplierQualityFactors + getSupplierHealth —
 * this file stays a thin RBAC/scope wrapper, same as every other handler
 * here.
 */
export const supplierKpisHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = resolveSupplierScope(req, req.query.supplierId as string | undefined);
  const [factors, health] = await Promise.all([getSupplierQualityFactors(req.db!, supplierId), getSupplierHealth(req.db!, supplierId)]);
  res.json({ ...factors, health });
});

// ---------------------------------------------------------------------------
// Phase 7 — Supplier Quality Risk Score (read-only passthrough; the
// internal-only recompute/write path lives on the `suppliers` module — see
// supplier.controller.ts's recomputeSupplierRiskScoreHandler. A supplier
// login may only ever read its own latest score + trend, never trigger a
// recompute itself.)
// ---------------------------------------------------------------------------

export const supplierRiskScoreHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = resolveSupplierScope(req, req.query.supplierId as string | undefined);
  res.json(await getSupplierRiskScoreWithTrend(req.db!, supplierId));
});

export const supplierScorecardExportHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = resolveSupplierScope(req, req.query.supplierId as string | undefined);
  const format = (req.query.format as string | undefined) || "csv";
  const [supplier] = await req.db!.select().from(suppliers).where(and(eq(suppliers.id, supplierId)));
  if (!supplier) throw AppError.notFound("Supplier");
  await exportSupplierScorecard(req, res, supplier, format);
});

// ---------------------------------------------------------------------------
// Settings — a minimal, real field set (contactEmail) directly on the
// existing `suppliers` row; deliberately not a second parallel settings
// table for one field.
// ---------------------------------------------------------------------------

export const getSupplierSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = resolveSupplierScope(req, req.query.supplierId as string | undefined);
  const [supplier] = await req.db!.select().from(suppliers).where(and(eq(suppliers.id, supplierId)));
  if (!supplier) throw AppError.notFound("Supplier");
  res.json({ id: supplier.id, name: supplier.name, contactEmail: supplier.contactEmail });
});

export const updateSupplierSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = resolveSupplierScope(req, req.body.supplierId);
  const { contactEmail } = req.body as { contactEmail?: string };
  const [updated] = await req.db!.update(suppliers).set({ contactEmail }).where(and(eq(suppliers.id, supplierId))).returning();
  if (!updated) throw AppError.notFound("Supplier");

  await recordAuditTrail(req.db!, { entityType: "Supplier", entityId: supplierId, action: "update", changes: { contactEmail }, performedBy: req.user?.id });
  res.json({ id: updated.id, name: updated.name, contactEmail: updated.contactEmail });
});
