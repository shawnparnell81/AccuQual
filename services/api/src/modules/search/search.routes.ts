import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { withSiteContext } from "../sites/siteContext.js";
import { searchHandler } from "./search.controller.js";

/**
 * No requireDepartmentAccess here — this one endpoint spans NCR/CAPA/Audit/
 * Supplier/Inventory/ERP/Training/Calibration, each with a different real
 * department rule, so the per-type filtering happens inside searchHandler
 * (see its canRead()) rather than gating the whole route by one resource key.
 */
export const searchRouter = Router();
searchRouter.use(requireAuth, withDb, withSiteContext);
searchRouter.get("/", searchHandler);
