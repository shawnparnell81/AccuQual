import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { withDb } from "../../lib/requestDb.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import type { Db } from "../../lib/requestDb.js";
import { retryFailedNotifications } from "./notification.service.js";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth, withDb, requireRole("admin"));

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
    const result = await retryFailedNotifications(req.db! as Db);
    res.json(result);
  })
);
