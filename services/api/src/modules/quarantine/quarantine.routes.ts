import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb, type TenantDb } from "../../lib/tenantScope.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import * as service from "./quarantine.service.js";
import { createQuarantineSchema, updateQuarantineSchema, releaseSchema, destroySchema, relocateSchema } from "./quarantine.validation.js";

const idParam = (req: Request) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw AppError.badRequest("Invalid id");
  return id;
};
const dbOf = (req: Request) => req.db as TenantDb;
const actorOf = (req: Request) => ({ id: req.user!.id, roleName: req.user!.roleName });

/**
 * Quarantine: holds on material (and other things) until a person decides their fate.
 *   quarantine.view     see holds and where held material is
 *   quarantine.manage   place a hold, edit it, move held material
 *   quarantine.release  release or destroy a hold (edit access AND a reviewer role: admin or quality manager)
 */
export const quarantineRouter = Router();
quarantineRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("quarantine"));

const view = requirePermission("quarantine.view");
const manage = requirePermission("quarantine.manage");
const release = requirePermission("quarantine.release");

// Fixed paths first: "summary" and "inventory" must not be read as an :id.
quarantineRouter.get(
  "/",
  view,
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as Record<string, string | undefined>;
    res.json(await service.listQuarantine(dbOf(req), req.tenantId!, { status: q.status, itemType: q.itemType, q: q.q, olderThanDays: q.olderThanDays ? Number(q.olderThanDays) : undefined }));
  }),
);
quarantineRouter.get(
  "/summary",
  view,
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.summary(dbOf(req), req.tenantId!));
  }),
);
quarantineRouter.get(
  "/inventory",
  view,
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.listInventory(dbOf(req), req.tenantId!, typeof req.query.location === "string" ? req.query.location : undefined));
  }),
);

quarantineRouter.post(
  "/",
  manage,
  validate(createQuarantineSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json(await service.createQuarantine(dbOf(req), req.tenantId!, req.body as service.CreateInput, req.user?.id));
  }),
);

quarantineRouter.get(
  "/:id",
  view,
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.getQuarantine(dbOf(req), req.tenantId!, idParam(req)));
  }),
);

quarantineRouter.patch(
  "/:id",
  manage,
  validate(updateQuarantineSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.updateQuarantine(dbOf(req), req.tenantId!, idParam(req), req.body as Parameters<typeof service.updateQuarantine>[3], req.user?.id));
  }),
);

quarantineRouter.post(
  "/:id/relocate",
  manage,
  validate(relocateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    await service.relocate(dbOf(req), req.tenantId!, idParam(req), req.body as { fromLocation: string; toLocation: string; quantity: number }, req.user?.id);
    res.json(await service.getQuarantine(dbOf(req), req.tenantId!, idParam(req)));
  }),
);

quarantineRouter.post(
  "/:id/release",
  release,
  validate(releaseSchema),
  asyncHandler(async (req: Request, res: Response) => {
    await service.resolveQuarantine(dbOf(req), req.tenantId!, idParam(req), "release", req.body as service.ResolveInput, actorOf(req));
    res.json(await service.getQuarantine(dbOf(req), req.tenantId!, idParam(req)));
  }),
);

quarantineRouter.post(
  "/:id/destroy",
  release,
  validate(destroySchema),
  asyncHandler(async (req: Request, res: Response) => {
    await service.resolveQuarantine(dbOf(req), req.tenantId!, idParam(req), "destroy", req.body as service.ResolveInput, actorOf(req));
    res.json(await service.getQuarantine(dbOf(req), req.tenantId!, idParam(req)));
  }),
);
