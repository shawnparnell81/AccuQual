import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { getKpiCounts } from "./nav.controller.js";

export const navRouter = Router();
navRouter.use(requireAuth, withTenantDb);

navRouter.get("/kpi-counts", getKpiCounts);
