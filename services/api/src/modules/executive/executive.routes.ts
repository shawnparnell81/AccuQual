import { Router } from "express";
import type { Request } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { roleHasExecutiveDashboard } from "../roles/rolePermissions.js";
import { getSiteContext } from "../sites/sites.service.js";
import { buildDashboard, drillRecords, resetLayout, saveLayout } from "./executive.service.js";
import { DATE_RANGES, WIDGET_KINDS, parseLayout, type DateRange, type WidgetKind } from "./executive.model.js";

export const executiveRouter = Router();
executiveRouter.use(requireAuth, withDb);

const requireExecutive = asyncHandler(async (req, _res, next) => {
  if (!req.db || !req.user) return next(AppError.unauthorized("Not signed in"));
  const allowed = await roleHasExecutiveDashboard(req.db, req.user.roleName);
  if (!allowed) return next(AppError.forbidden("You don't have access to the executive dashboard."));
  next();
});

executiveRouter.use(requireExecutive);

async function viewer(req: Request) {
  const context = await getSiteContext(req.db!, req.user!.id, req.user?.roleName ?? null);
  return {
    sites: context.sites.map((site) => ({ id: site.id, name: site.name })),
    includeUnassigned: context.canViewAllSites,
  };
}

executiveRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const view = await viewer(req);
    res.json(await buildDashboard(req.db!, req.user!.id, view.sites, view.includeUnassigned));
  }),
);

executiveRouter.put(
  "/layout",
  asyncHandler(async (req, res) => {
    const layout = parseLayout(req.body);
    if (!layout) throw AppError.badRequest("That dashboard layout isn't valid.");
    await saveLayout(req.db!, req.user!.id, layout);
    const view = await viewer(req);
    res.json(await buildDashboard(req.db!, req.user!.id, view.sites, view.includeUnassigned));
  }),
);

executiveRouter.delete(
  "/layout",
  asyncHandler(async (req, res) => {
    await resetLayout(req.db!, req.user!.id);
    const view = await viewer(req);
    res.json(await buildDashboard(req.db!, req.user!.id, view.sites, view.includeUnassigned));
  }),
);

executiveRouter.get(
  "/records",
  asyncHandler(async (req, res) => {
    const kind = String(req.query.kind ?? "");
    const bucket = String(req.query.bucket ?? "");
    const dateRange = String(req.query.dateRange ?? "");
    const kinds = WIDGET_KINDS as readonly string[];
    const ranges = DATE_RANGES as readonly string[];
    if (!kinds.includes(kind) || !ranges.includes(dateRange) || bucket.length === 0 || bucket.length > 200) {
      throw AppError.badRequest("Choose a number on the dashboard to open its list.");
    }
    const view = await viewer(req);
    const rawSite = req.query.siteId;
    let siteId: number | null = null;
    if (rawSite != null && rawSite !== "" && rawSite !== "unassigned") {
      siteId = Number(rawSite);
      if (!Number.isInteger(siteId) || !view.sites.some((site) => site.id === siteId)) {
        throw AppError.forbidden("You aren't assigned to that plant.");
      }
    } else if (!view.includeUnassigned) {
      throw AppError.badRequest("Choose a plant.");
    }
    res.json(
      await drillRecords(req.db!, view.sites, view.includeUnassigned, {
        kind: kind as WidgetKind,
        siteId,
        bucket,
        dateRange: dateRange as DateRange,
      }),
    );
  }),
);
