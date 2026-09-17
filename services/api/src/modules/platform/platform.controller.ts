import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as platformService from "./platform.service.js";

export const createTenantHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await platformService.createTenant(req.body);
  res.status(201).json(result);
});

export const listTenantsHandler = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await platformService.listTenants());
});

export const updateTenantHandler = asyncHandler(async (req: Request, res: Response) => {
  const updated = await platformService.updateTenant(Number(req.params.id), req.body);
  res.json(updated);
});

export const deleteTenantHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await platformService.deleteTenant(Number(req.params.id));
  res.json(tenant);
});

export const getAiOverviewHandler = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await platformService.getAiOverview());
});
