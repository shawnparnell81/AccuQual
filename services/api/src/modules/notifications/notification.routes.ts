import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import type { TenantDb } from "../../lib/tenantScope.js";
import { retryFailedNotifications } from "./notification.service.js";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth, withTenantDb, requireRole("admin"));

/**
 * POST /notifications/retry-failed — Phase 1 email infrastructure's
 * explicit "queue" trigger (see notification.service.ts's own comment on
 * retryFailedNotifications: no background worker exists in this app to
 * retry automatically, same honest limitation ERP Sync's own trigger-only
 * design already has). Admin-only, same as ERP Sync's own trigger endpoint.
 */
notificationsRouter.post(
  "/retry-failed",
  asyncHandler(async (req, res) => {
    const result = await retryFailedNotifications(req.db! as TenantDb, req.tenantId!);
    res.json(result);
  })
);
