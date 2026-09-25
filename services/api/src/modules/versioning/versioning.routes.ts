import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { withDb } from "../../lib/requestDb.js";
import { requirePermission, type PermissionSubject } from "../../middleware/requirePermission.js";
import type { Db } from "../../lib/requestDb.js";
import * as engine from "./versioning.service.js";
import type { Actor, SubjectAdapter } from "./versioning.service.js";
import { contextAdapter, managementReviewAdapter } from "./adapters.js";

const idParam = (req: Request) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw AppError.badRequest("Invalid id");
  return id;
};
const actorOf = (req: Request): Actor => ({ id: req.user!.id, roleName: req.user!.roleName });
const dbOf = (req: Request) => req.db as Db;

export const draftSchema = z.object({ payload: z.record(z.string(), z.unknown()).optional(), summary: z.string().max(500).optional() });
export const saveDraftSchema = z.object({ payload: z.record(z.string(), z.unknown()).optional(), summary: z.string().max(500).optional() });
export const reviewSchema = z.object({
  versionId: z.number().int().positive(),
  action: z.enum(["request", "approve", "reject"]),
  notes: z.string().max(4000).optional(),
  /** Name who should review it (used by controlled documents; ignored elsewhere). */
  reviewerId: z.number().int().positive().optional(),
});
export const publishSchema = z.object({ versionId: z.number().int().positive() });
export const rollbackSchema = z.object({ versionNumber: z.number().int().positive() });
export const validateSchema = z.object({ payload: z.record(z.string(), z.unknown()) });

/**
 * Adds the shared version-control endpoints for one subject to a router. The router already applies
 * requireAuth + withDb; every route here adds its own permission gate:
 *   view    read-only endpoints
 *   edit    starting, editing, discarding a draft; asking for review; rolling back
 *   review  approving or rejecting
 *   publish publishing
 */
export function registerVersionRoutes(router: Router, cfg: { adapter: SubjectAdapter; permission: PermissionSubject; mountAt?: string }) {
  const { adapter, permission } = cfg;
  const view = requirePermission(`${permission}.view`);
  const edit = requirePermission(`${permission}.edit`);
  const review = requirePermission(`${permission}.review`);
  const publish = requirePermission(`${permission}.publish`);

  // The current state of the subject: what is in force, and what is being worked on.
  router.get(
    "/:id/current",
    view,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await engine.getCurrent(dbOf(req), adapter));
    }),
  );

  router.get(
    "/:id/versions",
    view,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await engine.listVersions(dbOf(req), adapter));
    }),
  );

  router.get(
    "/:id/versions/:versionId",
    view,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await engine.getVersion(dbOf(req), adapter, idParam(req), Number(req.params.versionId)));
    }),
  );

  router.get(
    "/:id/version/:versionId/diff",
    view,
    asyncHandler(async (req: Request, res: Response) => {
      const against = req.query.against !== undefined ? Number(req.query.against) : undefined;
      if (against !== undefined && !Number.isInteger(against)) throw AppError.badRequest("against must be a version id");
      res.json(await engine.diffVersions(dbOf(req), adapter, Number(req.params.versionId), against, actorOf(req)));
    }),
  );

  router.post(
    "/:id/draft",
    edit,
    validate(draftSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const body = req.body as z.infer<typeof draftSchema>;
      res.status(201).json(await engine.createDraft(dbOf(req), adapter, actorOf(req), { payload: body.payload, summary: body.summary }));
    }),
  );

  router.put(
    "/:id/versions/:versionId",
    edit,
    validate(saveDraftSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const body = req.body as z.infer<typeof saveDraftSchema>;
      res.json(await engine.saveDraft(dbOf(req), adapter, Number(req.params.versionId), actorOf(req), body));
    }),
  );

  router.delete(
    "/:id/versions/:versionId",
    edit,
    asyncHandler(async (req: Request, res: Response) => {
      await engine.discardDraft(dbOf(req), adapter, Number(req.params.versionId), actorOf(req));
      res.status(204).send();
    }),
  );

  // Live check for an editor: the same rules submitting and publishing apply, without saving anything.
  router.post(
    "/:id/validate",
    view,
    validate(validateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const report = adapter.validate((req.body as z.infer<typeof validateSchema>).payload);
      res.json({ valid: report.errors.length === 0, ...report });
    }),
  );

  // Ask for review, or (with the reviewer's permission) approve / send back.
  router.post(
    "/:id/review",
    validate(reviewSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const body = req.body as z.infer<typeof reviewSchema>;
      // Which permission applies depends on the action, so the gate is chosen here rather than at route level.
      const gate = body.action === "request" ? edit : review;
      await new Promise<void>((resolve, reject) => gate(req, res, (err?: unknown) => (err ? reject(err) : resolve())));
      const db = dbOf(req);
      const id = idParam(req);
      if (body.action === "request") res.json(await engine.submitForReview(db, adapter, body.versionId, actorOf(req), body.notes, { reviewerId: body.reviewerId }));
      else res.json(await engine.reviewVersion(db, adapter, body.versionId, actorOf(req), body.action === "approve" ? "approved" : "rejected", body.notes));
    }),
  );

  router.post(
    "/:id/publish",
    publish,
    validate(publishSchema),
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await engine.publishVersion(dbOf(req), adapter, (req.body as z.infer<typeof publishSchema>).versionId, actorOf(req)));
    }),
  );

  router.post(
    "/:id/rollback",
    edit,
    validate(rollbackSchema),
    asyncHandler(async (req: Request, res: Response) => {
      res.status(201).json(await engine.rollbackTo(dbOf(req), adapter, (req.body as z.infer<typeof rollbackSchema>).versionNumber, actorOf(req)));
    }),
  );
}

/**
 * Router for a tenant-singleton controlled document (Management Review, Context of the Organization). There is one
 * record per tenant, always id 1 — the same singleton the forms engine has always used for it — so `POST /` simply
 * makes sure it exists and returns its current state.
 */
function createDocumentRouter(adapter: SubjectAdapter, permission: PermissionSubject): Router {
  const router = Router();
  router.use(requireAuth, withDb);
  router.param("id", (req, _res, next, value) => (Number(value) === 1 ? next() : next(AppError.notFound(adapter.noun))));

  router.post(
    "/",
    requirePermission(`${permission}.edit`),
    asyncHandler(async (req: Request, res: Response) => {
      res.status(200).json({ id: 1, ...(await engine.getCurrent(dbOf(req), adapter)) });
    }),
  );
  router.get(
    "/:id",
    requirePermission(`${permission}.view`),
    asyncHandler(async (req: Request, res: Response) => {
      res.json({ id: 1, ...(await engine.getCurrent(dbOf(req), adapter)) });
    }),
  );
  registerVersionRoutes(router, { adapter, permission });
  return router;
}

export const managementReviewRouter = createDocumentRouter(managementReviewAdapter, "managementReview");
export const contextRouter = createDocumentRouter(contextAdapter, "context");
