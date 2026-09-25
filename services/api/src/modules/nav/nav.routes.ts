import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { withSiteContext } from "../sites/siteContext.js";
import { validate } from "../../middleware/validate.js";
import { navScopeSchema } from "./nav.validation.js";
import { getKpiCounts } from "./nav.controller.js";
import { listHidden, hideItem, showItem } from "./nav-preferences.controller.js";

export const navRouter = Router();
navRouter.use(requireAuth, withDb, withSiteContext);

navRouter.get("/kpi-counts", getKpiCounts);

navRouter.get("/hidden", listHidden);
navRouter.post("/hidden", validate(navScopeSchema), hideItem);
navRouter.delete("/hidden", validate(navScopeSchema), showItem);
