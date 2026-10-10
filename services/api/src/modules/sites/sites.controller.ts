import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { changeRecordSite, isRecordSiteEntity, readRecordSite } from "./recordSite.js";
import * as sitesService from "./sites.service.js";

export const getContextHandler = asyncHandler(async (req: Request, res: Response) => {
  const context = await sitesService.getSiteContext(req.db!, req.user!.id, req.user?.roleName ?? null);
  res.json(context);
});

export const switchHandler = asyncHandler(async (req: Request, res: Response) => {
  const context = await sitesService.applySiteSwitch(req.db!, req.user!.id, req.user?.roleName ?? null, req.body);
  res.json(context);
});

export const getRecordSiteHandler = asyncHandler(async (req: Request, res: Response) => {
  const entity = String(req.query.entity ?? "");
  const id = Number(req.query.id);
  if (!isRecordSiteEntity(entity) || !Number.isInteger(id) || id < 1) throw AppError.badRequest("Choose a record.");
  res.json(await readRecordSite(req.db!, entity, id));
});

export const changeRecordSiteHandler = asyncHandler(async (req: Request, res: Response) => {
  const updated = await changeRecordSite(
    req.db!,
    { id: req.user!.id, roleName: req.user?.roleName ?? null, department: req.user?.department ?? null },
    req.body.entity,
    req.body.id,
    req.body.siteId,
  );
  res.json(updated);
});

export const createHandler = asyncHandler(async (req: Request, res: Response) => {
  const created = await sitesService.createSite(req.db!, req.user!.id, req.body);
  res.status(201).json(created);
});

export const updateHandler = asyncHandler(async (req: Request, res: Response) => {
  const updated = await sitesService.updateSite(req.db!, req.user!.id, Number(req.params.id), req.body);
  res.json(updated);
});

export const deleteHandler = asyncHandler(async (req: Request, res: Response) => {
  const deleted = await sitesService.deleteSite(req.db!, req.user!.id, Number(req.params.id));
  res.json(deleted);
});

export const listMembersHandler = asyncHandler(async (req: Request, res: Response) => {
  const userIds = await sitesService.listMemberIds(req.db!, Number(req.params.id));
  res.json({ userIds });
});

export const replaceMembersHandler = asyncHandler(async (req: Request, res: Response) => {
  const userIds = await sitesService.replaceMembers(req.db!, req.user!.id, Number(req.params.id), req.body.userIds);
  res.json({ userIds });
});
