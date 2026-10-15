import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { approveFormRevision, getFormRevisions, rejectFormRevision, startFormRevision, type Actor } from "./service.js";

function actor(req: Request): Actor {
  if (!req.user) throw AppError.unauthorized();
  return { id: req.user.id, roleName: req.user.roleName ?? null, department: req.user.department ?? null };
}

function keyOf(value: unknown): string {
  const key = typeof value === "string" ? value.trim() : "";
  if (!key || key.length > 100) throw AppError.badRequest("Unknown form.");
  return key;
}

function idOf(value: unknown): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw AppError.badRequest("Unknown revision.");
  return id;
}

const body = (req: Request) => (req.body ?? {}) as Record<string, unknown>;

export const formRevisionsRouter = Router();
formRevisionsRouter.use(requireAuth, withDb);

formRevisionsRouter.get(
  "/:formKey",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await getFormRevisions(req.db!, actor(req), keyOf(req.params.formKey)));
  }),
);
formRevisionsRouter.post(
  "/:formKey",
  asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json(await startFormRevision(req.db!, actor(req), keyOf(req.params.formKey), body(req)));
  }),
);
formRevisionsRouter.post(
  "/:formKey/:id/approve",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await approveFormRevision(req.db!, actor(req), keyOf(req.params.formKey), idOf(req.params.id), body(req)));
  }),
);
formRevisionsRouter.post(
  "/:formKey/:id/reject",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await rejectFormRevision(req.db!, actor(req), keyOf(req.params.formKey), idOf(req.params.id), body(req)));
  }),
);
