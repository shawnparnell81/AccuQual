import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { crudFactory } from "../../utils/crudFactory.js";
import * as ncrService from "./ncr.service.js";
import { syncNcrFormData, mapSeverityToClassification, ncrIsoDate } from "./ncr.formSync.js";

export const baseHandlers = crudFactory(ncr, {
  entityName: "NCR",
  idColumn: "id",
  softDelete: true,
  siteScoped: true,
  // Phase 2 NCR unified-data-model fix — see ncr.formSync.ts's own comment.
  // A brand-new NCR gets its official document seeded immediately (never
  // starts totally blank again); a direct PATCH to description/severity
  // keeps that document's matching fields in step.
  afterCreate: async (created, req) => {
    const row = created as { id: number; description: string | null; severity: string | null; createdAt: Date | string };
    await syncNcrFormData(
      req.db!,
      req.tenantId!,
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
  },
  afterUpdate: async (updated, req) => {
    const row = updated as { id: number; description: string | null; severity: string | null };
    const patch: Parameters<typeof syncNcrFormData>[3] = {};
    if ("description" in req.body) patch.nonconformanceDescription = row.description ?? undefined;
    if ("severity" in req.body) patch.ncrClassification = mapSeverityToClassification(row.severity);
    if (Object.keys(patch).length > 0) await syncNcrFormData(req.db!, req.tenantId!, row.id, patch, req.user?.id);
  },
});

/**
 * GET /ncr — Phase 8 adds optional `?receivingLineItemId=`/`?supplierId=`
 * filters on top of baseHandlers.list's plain "every NCR for this tenant"
 * (the traceability chain — receiving → inventory → NCR → CAPA → warranty
 * — needs a real way to ask "which NCR(s) came from this receiving
 * event/supplier" without a client fetching every NCR and filtering
 * client-side). Falls through to the exact same query when neither is
 * given, so every existing caller is unaffected.
 */
export const listHandler = asyncHandler(async (req: Request, res: Response) => {
  const { receivingLineItemId, supplierId } = req.query as Record<string, string | undefined>;
  if (!receivingLineItemId && !supplierId) return baseHandlers.list(req, res, () => undefined);

  if (!req.siteId) {
    res.json([]);
    return;
  }
  const conditions = [eq(ncr.tenantId, req.tenantId!), eq(ncr.isDeleted, false), eq(ncr.siteId, req.siteId)];
  if (receivingLineItemId) conditions.push(eq(ncr.receivingLineItemId, Number(receivingLineItemId)));
  if (supplierId) conditions.push(eq(ncr.supplierId, Number(supplierId)));
  const rows = await req.db!.select().from(ncr).where(and(...conditions));
  res.json(rows);
});

export const assignHandler = asyncHandler(async (req: Request, res: Response) => {
  const updated = await ncrService.assign(req.db!, req.tenantId!, Number(req.params.id), req.body.assignedTo, req.user?.id, req.allowedSiteIds);
  res.json(updated);
});

export const containmentHandler = asyncHandler(async (req: Request, res: Response) => {
  const updated = await ncrService.setContainment(req.db!, req.tenantId!, Number(req.params.id), req.body.containment, req.user?.id, req.allowedSiteIds);
  res.json(updated);
});

export const rootCauseHandler = asyncHandler(async (req: Request, res: Response) => {
  const updated = await ncrService.setRootCause(req.db!, req.tenantId!, Number(req.params.id), req.body.rootCause, req.user?.id, req.allowedSiteIds);
  res.json(updated);
});

export const correctiveActionHandler = asyncHandler(async (req: Request, res: Response) => {
  const updated = await ncrService.setCorrectiveAction(req.db!, req.tenantId!, Number(req.params.id), req.body.correctiveAction, req.user?.id, req.allowedSiteIds);
  res.json(updated);
});

export const closeHandler = asyncHandler(async (req: Request, res: Response) => {
  const updated = await ncrService.close(req.db!, req.tenantId!, Number(req.params.id), req.user?.id, req.allowedSiteIds);
  res.json(updated);
});
