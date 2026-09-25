import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { authRateLimiter } from "../../middleware/rateLimit.js";
import { withDb } from "../../lib/requestDb.js";
import { addSsoDomain, addDomainSchema, deleteSsoConfig, deleteSsoDomain, getSsoConfig, saveConnectionSchema, saveSsoConfig, ssoCallback, ssoDiscover, ssoStart, verifySsoDomain } from "./sso.controller.js";

/** The browser-facing sign-in flow — no session exists yet, so nothing here uses requireAuth. Mounted at /auth/sso. */
export const ssoPublicRouter = Router();
ssoPublicRouter.get("/discover", authRateLimiter, ssoDiscover);
ssoPublicRouter.get("/start", authRateLimiter, ssoStart);
ssoPublicRouter.get("/callback", authRateLimiter, ssoCallback);

/** A tenant admin's own SSO settings. Mounted at /sso. */
export const ssoAdminRouter = Router();
ssoAdminRouter.use(requireAuth, withDb, requireRole("admin"));
ssoAdminRouter.get("/", getSsoConfig);
ssoAdminRouter.put("/", validate(saveConnectionSchema), saveSsoConfig);
ssoAdminRouter.delete("/", deleteSsoConfig);
ssoAdminRouter.post("/domains", validate(addDomainSchema), addSsoDomain);
ssoAdminRouter.post("/domains/:id/verify", verifySsoDomain);
ssoAdminRouter.delete("/domains/:id", deleteSsoDomain);
