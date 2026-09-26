import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import * as service from "./worker.service.js";
import { upsertWorkerProfileSchema } from "./worker.validation.js";

const idParam = (req: Request) => {
  const id = Number(req.params.userId);
  if (!Number.isInteger(id) || id < 1) throw AppError.badRequest("Invalid user id");
  return id;
};

/** Roster of every internal user, their department/role, and their (possibly blank) worker profile fields. */
export const listWorkersHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await service.listWorkers(req.db!));
});

/** Self-service: a person's own profile + activity, with no extra permission gate — the same "my own data" carve-out the self-service Calendar and nav KPI endpoints already use. */
export const getMyWorkerHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const [profile, activity] = await Promise.all([service.getOwnWorkerProfile(req.db!, userId), service.getOwnWorkerActivity(req.db!, userId)]);
  res.json({ profile, activity });
});

export const getWorkerHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = idParam(req);
  const [profile, activity] = await Promise.all([service.getWorkerProfile(req.db!, userId), service.getWorkerActivity(req.db!, userId)]);
  res.json({ profile, activity });
});

export const upsertWorkerHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = idParam(req);
  const input = upsertWorkerProfileSchema.parse(req.body);
  // getWorkerProfile always returns a view (defaults filled in) as long as the user exists, even with no profile row yet —
  // profileRowExists is what actually distinguishes "first time" from "editing again" for the audit entry's action.
  const [existedBefore, before] = await Promise.all([service.profileRowExists(req.db!, userId), service.getWorkerProfile(req.db!, userId)]);
  const profile = await service.upsertWorkerProfile(req.db!, userId, input, req.user!.id);
  await recordAuditTrail(req.db!, {
    entityType: "WorkerProfile",
    entityId: userId,
    action: existedBefore ? "update" : "create",
    changes: { before, after: profile },
    performedBy: req.user!.id,
  });
  res.json(profile);
});
