import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { withDb } from "../../lib/requestDb.js";
import { getSystemHealthHandler } from "./systemHealth.controller.js";

/** Admin Console "System Health" (Phase 10) — cross-module diagnostics, admin-only (like every other cross-cutting tenant-admin surface: tenant.routes.ts's ai-config/ai-usage). */
export const systemHealthRouter = Router();
systemHealthRouter.use(requireAuth, withDb, requireRole("admin"));
systemHealthRouter.get("/", getSystemHealthHandler);
