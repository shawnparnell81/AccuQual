import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { withSiteContext } from "../sites/siteContext.js";
import { createLaborClaimSchema, updateLaborClaimSchema } from "./laborClaims.validation.js";
import {
  beginLaborClaimEdit,
  createLaborClaimHandler,
  deleteLaborClaimHandler,
  getLaborClaimHandler,
  listLaborClaimsHandler,
  updateLaborClaimHandler,
} from "./laborClaims.controller.js";

/**
 * Labor Claims uses the labor_claims permission. Who may read or edit is
 * the Roles & Permissions row, not a role name in this file.
 */
export const laborClaimsRouter = Router();
laborClaimsRouter.use(requireAuth, withDb, withSiteContext, requireDepartmentAccess("labor_claims"));

laborClaimsRouter.get("/", listLaborClaimsHandler);
laborClaimsRouter.post("/", validate(createLaborClaimSchema), createLaborClaimHandler);
laborClaimsRouter.get("/:id", getLaborClaimHandler);
laborClaimsRouter.patch("/:id", validate(updateLaborClaimSchema), updateLaborClaimHandler);
laborClaimsRouter.delete("/:id", deleteLaborClaimHandler);
laborClaimsRouter.post("/:id/begin-edit", beginLaborClaimEdit);
