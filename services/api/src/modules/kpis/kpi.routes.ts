import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { buildKpiPayload, deactivateObjective, readChartLayout, recordsFor, requireObjectiveEditor, resetChartLayout, saveObjective, writeChartLayout } from "./kpi.service.js";
import { chartLayoutSchema, objectiveBodySchema } from "./kpi.validation.js";
import type { ObjectiveInput } from "./kpi.service.js";

export const kpisRouter = Router();
kpisRouter.use(requireAuth, withDb);

kpisRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const payload = await buildKpiPayload(req.db!, req.user?.roleName);
    const layout = await readChartLayout(req.db!, req.user!.id);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ ...payload, layout });
  }),
);

kpisRouter.get(
  "/records",
  asyncHandler(async (req, res) => {
    const metric = String(req.query.metric ?? "");
    const month = String(req.query.month ?? "");
    const rawSite = req.query.siteId;
    const siteId = rawSite == null || rawSite === "" || rawSite === "all" ? null : Number(rawSite);
    if (siteId != null && !Number.isInteger(siteId)) throw AppError.badRequest("Choose a plant.");
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await recordsFor(req.db!, metric, month, siteId));
  }),
);

kpisRouter.post(
  "/objectives",
  validate(objectiveBodySchema),
  asyncHandler(async (req, res) => {
    requireObjectiveEditor(req.user?.roleName);
    const saved = await saveObjective(req.db!, req.user?.id, req.body as ObjectiveInput);
    res.status(201).json(saved);
  }),
);

kpisRouter.patch(
  "/objectives/:id",
  validate(objectiveBodySchema),
  asyncHandler(async (req, res) => {
    requireObjectiveEditor(req.user?.roleName);
    res.json(await saveObjective(req.db!, req.user?.id, req.body as ObjectiveInput, String(req.params.id)));
  }),
);

kpisRouter.post(
  "/objectives/:id/deactivate",
  asyncHandler(async (req, res) => {
    requireObjectiveEditor(req.user?.roleName);
    res.json(await deactivateObjective(req.db!, req.user?.id, String(req.params.id)));
  }),
);

kpisRouter.put(
  "/layout",
  validate(chartLayoutSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as { surface: "home" | "executive"; order: string[] };
    res.json(await writeChartLayout(req.db!, req.user!.id, body.surface, body.order));
  }),
);

kpisRouter.delete(
  "/layout",
  asyncHandler(async (req, res) => {
    const surface = req.query.surface === "home" || req.query.surface === "executive" || req.query.surface === "all" ? req.query.surface : null;
    if (!surface) throw AppError.badRequest("Choose home, executive, or all.");
    res.json(await resetChartLayout(req.db!, req.user!.id, surface));
  }),
);
