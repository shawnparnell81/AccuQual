import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireRolePermission } from "../../middleware/rbac.js";
import { ADMIN_CONSOLE_PERMISSION } from "../roles/roleAccess.js";
import { withDb } from "../../lib/requestDb.js";
import { getSystemHealthHandler } from "./systemHealth.controller.js";

/** Admin Console "System Health" (Phase 10) — cross-module diagnostics, admin-only (like every other cross-cutting company-admin surface: company.routes.ts's ai-config/ai-usage). */
export const systemHealthRouter = Router();
systemHealthRouter.use(requireAuth, withDb, requireRolePermission(ADMIN_CONSOLE_PERMISSION));
systemHealthRouter.get("/", getSystemHealthHandler);
