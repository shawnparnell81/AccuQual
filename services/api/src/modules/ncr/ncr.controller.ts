import type { NextFunction, Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { crudFactory } from "../../utils/crudFactory.js";
import * as ncrService from "./ncr.service.js";
import { syncNcrFormData, mapSeverityToClassification, ncrIsoDate } from "./ncr.formSync.js";
import * as quarantineService from "../quarantine/quarantine.service.js";
import { noteRepeatNcr, repeatReport } from "../quality-automation/qualityAutomation.service.js";

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

export const completeNcrDispositionHandler = asyncHandler(async (req: Request, res: Response) => {
  const actor = { id: req.user?.id ?? 0, roleName: req.user?.roleName ?? null };
  const concession = req.body.disposition === "use_as_is" ? req.body.concession : undefined;
  const result = await quarantineService.completeNcrDisposition(req.db!, Number(req.params.id), req.body.disposition, actor, concession, req.body.release);
  res.json(result);
});
