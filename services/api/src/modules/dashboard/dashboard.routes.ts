import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { withSiteContext } from "../sites/siteContext.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { loadDashboardOverview } from "./dashboard.service.js";
import { loadWaitingOnMe, readWaitingPrefs } from "./waitingOnMe.service.js";
import { sanitizeWaitingPrefs } from "./waitingOnMe.js";
import { users } from "../../drizzle/schema/users.js";
import { eq } from "drizzle-orm";

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

dashboardRouter.get(
  "/waiting-on-me",
  asyncHandler(async (req, res) => {
    const raw = req.query.scope;
    if (raw != null && raw !== "all" && raw !== "current") throw AppError.badRequest("Scope must be current or all.");
    const allowed = req.allowedSiteIds ?? [];
    const siteIds = raw === "all" ? allowed : req.siteId != null ? [req.siteId] : [];
    const [row] = await req.db!.select({ workspaceLayout: users.workspaceLayout }).from(users).where(eq(users.id, req.user!.id));
    const saved = readWaitingPrefs(row?.workspaceLayout);
    const prefs = sanitizeWaitingPrefs({
      ...saved,
      ...(typeof req.query.sort === "string" ? { sort: req.query.sort } : {}),
      ...(typeof req.query.group === "string" ? { group: req.query.group } : {}),
      ...(typeof req.query.module === "string" ? { module: req.query.module } : {}),
      ...(typeof req.query.timing === "string" ? { timing: req.query.timing } : {}),
    });
    res.json(await loadWaitingOnMe(req.db!, { id: req.user!.id, roleName: req.user!.roleName, department: req.user!.department }, siteIds, prefs));
  }),
);
