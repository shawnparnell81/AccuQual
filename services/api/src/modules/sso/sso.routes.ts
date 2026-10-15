import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireRolePermission } from "../../middleware/rbac.js";
import { ADMIN_CONSOLE_PERMISSION } from "../roles/roleAccess.js";
import { validate } from "../../middleware/validate.js";
import { authRateLimiter } from "../../middleware/rateLimit.js";
import { withDb } from "../../lib/requestDb.js";
import { addSsoDomain, addDomainSchema, deleteSsoConfig, deleteSsoDomain, getSsoConfig, saveConnectionSchema, saveSsoConfig, ssoCallback, ssoDiscover, ssoStart, verifySsoDomain } from "./sso.controller.js";

/** The browser-facing sign-in flow — no session exists yet, so nothing here uses requireAuth. Mounted at /auth/sso. */
export const ssoPublicRouter = Router();
ssoPublicRouter.get("/discover", authRateLimiter, ssoDiscover);
ssoPublicRouter.get("/start", authRateLimiter, ssoStart);
ssoPublicRouter.get("/callback", authRateLimiter, ssoCallback);

/** The administrator's SSO settings. Mounted at /sso. */
export const ssoAdminRouter = Router();
ssoAdminRouter.use(requireAuth, withDb, requireRolePermission(ADMIN_CONSOLE_PERMISSION));
ssoAdminRouter.get("/", getSsoConfig);
ssoAdminRouter.put("/", validate(saveConnectionSchema), saveSsoConfig);
ssoAdminRouter.delete("/", deleteSsoConfig);
ssoAdminRouter.post("/domains", validate(addDomainSchema), addSsoDomain);
ssoAdminRouter.post("/domains/:id/verify", verifySsoDomain);
ssoAdminRouter.delete("/domains/:id", deleteSsoDomain);
