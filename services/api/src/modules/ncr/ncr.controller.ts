import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { crudFactory } from "../../utils/crudFactory.js";
import * as ncrService from "./ncr.service.js";

export const baseHandlers = crudFactory(ncr, { entityName: "NCR", idColumn: "id", softDelete: true });

export const assignHandler = asyncHandler(async (req: Request, res: Response) => {
  const updated = await ncrService.assign(req.db!, req.tenantId!, Number(req.params.id), req.body.assignedTo, req.user?.id);
  res.json(updated);
});

export const containmentHandler = asyncHandler(async (req: Request, res: Response) => {
  const updated = await ncrService.setContainment(req.db!, req.tenantId!, Number(req.params.id), req.body.containment, req.user?.id);
  res.json(updated);
});

export const rootCauseHandler = asyncHandler(async (req: Request, res: Response) => {
  const updated = await ncrService.setRootCause(req.db!, req.tenantId!, Number(req.params.id), req.body.rootCause, req.user?.id);
  res.json(updated);
});

export const correctiveActionHandler = asyncHandler(async (req: Request, res: Response) => {
  const updated = await ncrService.setCorrectiveAction(req.db!, req.tenantId!, Number(req.params.id), req.body.correctiveAction, req.user?.id);
  res.json(updated);
});

export const closeHandler = asyncHandler(async (req: Request, res: Response) => {
  const updated = await ncrService.close(req.db!, req.tenantId!, Number(req.params.id), req.user?.id);
  res.json(updated);
});
