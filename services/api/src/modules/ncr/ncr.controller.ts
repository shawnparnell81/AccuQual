import type { NextFunction, Request, Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { documents } from "../../drizzle/schema/documents.js";
import { assertRecordOnAllowedSite } from "../sites/siteAccess.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { writeStepDocuments } from "./ncrStepDocuments.js";
import { crudFactory } from "../../utils/crudFactory.js";
import * as ncrService from "./ncr.service.js";
import { syncNcrFormData, mapSeverityToClassification, ncrIsoDate } from "./ncr.formSync.js";
import * as quarantineService from "../quarantine/quarantine.service.js";
import { noteRepeatNcr, repeatReport } from "../quality-automation/qualityAutomation.service.js";
import { canonicalNcrStep, decorateNcrBody, ncrStatusAliases } from "./ncr.workflow.js";
import { ncrProcessMetrics, type NcrMetricSource } from "./ncrSla.js";

export const baseHandlers = crudFactory(ncr, {
  entityName: "NCR",
  idColumn: "id",
  softDelete: true,
  siteScoped: true,
  expandStatusFilter: ncrStatusAliases,
  prepareCreate: (body) => ({ ...body, status: typeof body.status === "string" ? canonicalNcrStep(body.status) : "ncr_created" }),
  // Phase 2 NCR unified-data-model fix — see ncr.formSync.ts's own comment.
  // A brand-new NCR gets its official document seeded immediately (never
  // starts totally blank again); a direct PATCH to description/severity
  // keeps that document's matching fields in step.
  afterCreate: async (created, req) => {
    const row = created as { id: number; description: string | null; severity: string | null; createdAt: Date | string };
    await syncNcrFormData(
      req.db!,
      row.id,
      {
        ncrNumber: `NCR-${row.id}`,
        dateIssued: ncrIsoDate(row.createdAt ?? new Date()),
        documentStatus: "Active",
        nonconformanceDescription: row.description ?? undefined,
        ncrClassification: mapSeverityToClassification(row.severity),
      },
      req.user?.id
    );
    await noteRepeatNcr(req.db!, row.id);
  },
  afterUpdate: async (updated, req) => {
    const row = updated as { id: number; description: string | null; severity: string | null };
    const patch: Parameters<typeof syncNcrFormData>[2] = {};
    if ("description" in req.body) patch.nonconformanceDescription = row.description ?? undefined;
    if ("severity" in req.body) patch.ncrClassification = mapSeverityToClassification(row.severity);
    if (Object.keys(patch).length > 0) await syncNcrFormData(req.db!, row.id, patch, req.user?.id);
    await noteRepeatNcr(req.db!, row.id);
  },
});

/** GET /ncr — filters (supplier, receiving line, owner, status, limit, offset) live on the shared list helper. */
export const listHandler = baseHandlers.list;

/** GET /ncr/process-metrics — dashboard counts for the NCR Process. Registered before /:id. */
export const processMetricsHandler = asyncHandler(async (req: Request, res: Response) => {
  const conditions = [eq(ncr.isDeleted, false)];
  if (req.siteId) conditions.push(eq(ncr.siteId, req.siteId));
  const rows = await req.db!.select().from(ncr).where(and(...conditions));
  const sources: NcrMetricSource[] = rows.map((row) => ({
    id: row.id,
    status: row.status,
    severity: row.severity,
    title: row.title,
    description: row.description,
    supplierId: row.supplierId,
    createdAt: row.createdAt,
    closedAt: row.closedAt,
    workflowStage: row.workflowStage,
    slaStatus: row.slaStatus,
    daysOpen: row.daysOpen,
    daysInStage: row.daysInStage,
    processData: row.processData,
  }));
  res.json(ncrProcessMetrics(sources));
});

/** A workflow close locks the record. The six-step form stays editable until that lock is set. */
export const rejectLockedNcr = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const ids = new Set<number>();
  const paramId = Number(req.params.id);
  if (Number.isFinite(paramId)) ids.add(paramId);
  if (Array.isArray(req.body?.ids)) for (const id of req.body.ids) if (Number.isFinite(Number(id))) ids.add(Number(id));
  for (const id of ids) {
    const [row] = await req.db!.select({ processData: ncr.processData }).from(ncr).where(eq(ncr.id, id));
    if (row?.processData?.locked === true) throw AppError.badRequest("This NCR is closed and locked.");
  }
  next();
});

export const repeatsHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await repeatReport(req.db!, Number(req.params.id), req.allowedSiteIds));
});

export const assignHandler = asyncHandler(async (req: Request, res: Response) => {
  const updated = await ncrService.assign(req.db!, Number(req.params.id), req.body.assignedTo, req.user?.id, req.allowedSiteIds);
  res.json(updated);
});

export const containmentHandler = asyncHandler(async (req: Request, res: Response) => {
  const updated = await ncrService.setContainment(req.db!, Number(req.params.id), req.body.containment, req.user?.id, req.allowedSiteIds);
  res.json(updated);
});

export const rootCauseHandler = asyncHandler(async (req: Request, res: Response) => {
  const updated = await ncrService.setRootCause(req.db!, Number(req.params.id), req.body.rootCause, req.user?.id, req.allowedSiteIds);
  res.json(updated);
});

export const correctiveActionHandler = asyncHandler(async (req: Request, res: Response) => {
  const updated = await ncrService.setCorrectiveAction(req.db!, Number(req.params.id), req.body.correctiveAction, req.user?.id, req.allowedSiteIds);
  res.json(updated);
});

export const closeHandler = asyncHandler(async (req: Request, res: Response) => {
  const updated = await ncrService.close(req.db!, Number(req.params.id), req.user?.id, req.allowedSiteIds);
  res.json(updated);
});

export const dispositionStepHandler = asyncHandler(async (req: Request, res: Response) => {
  const updated = await ncrService.setDispositionStep(req.db!, Number(req.params.id), req.body.note, req.user?.id, req.allowedSiteIds);
  res.json(updated);
});

export const verifyHandler = asyncHandler(async (req: Request, res: Response) => {
  const updated = await ncrService.setVerify(req.db!, Number(req.params.id), req.body.verification, req.user?.id, req.allowedSiteIds);
  res.json(updated);
});

/** Every NCR JSON response uses the current step key and carries workflow.currentStep, allowedTransitions, and history. */
export function presentNcrWorkflow(_req: Request, res: Response, next: NextFunction) {
  const send = res.json.bind(res);
  res.json = ((body: unknown) => send(decorateNcrBody(body))) as Response["json"];
  next();
}

/** PATCH can set status to closed without POST /close. Same On Hold gate, including bulk status changes. */
export const rejectCloseWhileQuarantineOnHold = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const status = req.body?.patch?.status ?? req.body?.status;
  if (status !== "closed") return next();
  const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids : [Number(req.params.id)];
  for (const id of ids) {
    if (await quarantineService.ncrQuarantineIsOnHold(req.db!, id)) throw AppError.badRequest(quarantineService.onHoldBlockMessage(id));
  }
  next();
});

export const listNcrQuarantineItemsHandler = asyncHandler(async (req: Request, res: Response) => {
  const ncrId = Number(req.params.id);
  res.json(await quarantineService.listQuarantineItems(req.db!, "active", ncrId));
});

export const addNcrQuarantineItemHandler = asyncHandler(async (req: Request, res: Response) => {
  const created = await quarantineService.addNcrQuarantineItem(req.db!, Number(req.params.id), req.body, req.user?.id);
  res.status(201).json(created);
});

/** PUT /ncr/:id/step-documents — published documents for one step. Other process fields stay. */
export const setNcrStepDocumentsHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const step = String(req.body.step);
  const requested = req.body.documents as { id: number; title: string }[];
  const [row] = await req.db!.select().from(ncr).where(eq(ncr.id, id));
  if (!row || row.isDeleted) throw AppError.notFound("NCR");
  assertRecordOnAllowedSite(row.siteId, req.allowedSiteIds, "NCR");
  if (row.processData?.locked === true) throw AppError.badRequest("This NCR is closed and locked.");
  const ids = [...new Set(requested.map((item) => item.id))];
  const found = ids.length === 0 ? [] : await req.db!.select({ id: documents.id, title: documents.title, status: documents.status }).from(documents).where(and(inArray(documents.id, ids), eq(documents.isDeleted, false), eq(documents.status, "approved")));
  if (found.length !== ids.length) throw AppError.badRequest("Link a published document. Drafts and missing files are not on this step.");
  const byId = new Map(found.map((item) => [item.id, item.title]));
  const linked = ids.map((documentId) => ({ id: documentId, title: byId.get(documentId) ?? requested.find((item) => item.id === documentId)?.title ?? "Document" }));
  const processData = writeStepDocuments(row.processData, step, linked);
  const [updated] = await req.db!.update(ncr).set({ processData, updatedAt: new Date() }).where(eq(ncr.id, id)).returning();
  await recordAuditTrail(req.db!, {
    entityType: "NCR",
    entityId: id,
    action: "update",
    changes: { stepDocuments: { step, documents: linked } },
    performedBy: req.user?.id,
  });
  res.json({ step, documents: linked, processData: updated?.processData ?? processData });
});

export const completeNcrDispositionHandler = asyncHandler(async (req: Request, res: Response) => {
  const actor = { id: req.user?.id ?? 0, roleName: req.user?.roleName ?? null };
  const concession = req.body.disposition === "use_as_is" ? req.body.concession : undefined;
  const result = await quarantineService.completeNcrDisposition(req.db!, Number(req.params.id), req.body.disposition, actor, concession, req.body.release);
  res.json(result);
});
