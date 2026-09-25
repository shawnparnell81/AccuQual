import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as sitesService from "./sites.service.js";

export const getContextHandler = asyncHandler(async (req: Request, res: Response) => {
  const context = await sitesService.getSiteContext(req.db!, req.user!.id, req.user?.roleName ?? null);
  res.json(context);
});

export const switchHandler = asyncHandler(async (req: Request, res: Response) => {
  const context = await sitesService.switchSite(req.db!, req.user!.id, req.user?.roleName ?? null, req.body.siteId);
  res.json(context);
});

export const createHandler = asyncHandler(async (req: Request, res: Response) => {
  const created = await sitesService.createSite(req.db!, req.user!.id, req.body);
  res.status(201).json(created);
});

export const updateHandler = asyncHandler(async (req: Request, res: Response) => {
  const updated = await sitesService.updateSite(req.db!, req.user!.id, Number(req.params.id), req.body);
  res.json(updated);
});

export const listMembersHandler = asyncHandler(async (req: Request, res: Response) => {
  const userIds = await sitesService.listMemberIds(req.db!, Number(req.params.id));
  res.json({ userIds });
});

export const replaceMembersHandler = asyncHandler(async (req: Request, res: Response) => {
  const userIds = await sitesService.replaceMembers(req.db!, req.user!.id, Number(req.params.id), req.body.userIds);
  res.json({ userIds });
});
