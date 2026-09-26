import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { withSiteContext } from "../sites/siteContext.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { loadDashboardOverview } from "./dashboard.service.js";

/**
 * One read-only summary for the signed-in dashboard. It is not gated by a
 * single module: each widget checks the same access as that module's own
 * pages, and leaves out anything this person cannot read.
 *
 * `?scope=all` covers every plant they belong to. Anything else uses the
 * plant already selected in the header.
 */
export const dashboardRouter = Router();
dashboardRouter.use(requireAuth, withDb, withSiteContext);

dashboardRouter.get(
  "/overview",
  asyncHandler(async (req, res) => {
    const raw = req.query.scope;
    if (raw != null && raw !== "all" && raw !== "current") {
      throw AppError.badRequest("Scope must be current or all.");
    }
    const allPlants = raw === "all";
    const allowed = req.allowedSiteIds ?? [];
    const kpiSiteIds = allPlants ? allowed : req.siteId != null ? [req.siteId] : [];
    const overview = await loadDashboardOverview(req.db!, { id: req.user!.id, roleName: req.user!.roleName, department: req.user!.department }, {
      kpiSiteIds,
      allPlants,
      allowedSiteIds: allowed,
    });
    res.json(overview);
  }),
);
