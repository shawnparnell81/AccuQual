import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import type { Db } from "../../lib/requestDb.js";
import { getMyNotificationPreferences, listMyNotifications, markAllNotificationsRead, markNotificationRead, updateMyNotificationPreferences } from "./notification.service.js";

// Self-service only — no requireRole here. Deliberately its own router,
// mounted at /notifications BEFORE notification.routes.ts's admin-only
// router in routes/index.ts: that other router's requireRole("admin") is
// applied at the router level (a blanket .use()), so if this were added to
// it instead, every request here would be refused for anyone but an admin
// before Express even looked at the specific path — the exact
// router-level-gate-catches-unrelated-routes mistake this codebase has
// already been bitten by once (see erpPresets.routes.ts's own history).
export const notificationsMeRouter = Router();
notificationsMeRouter.use(requireAuth, withDb);

/** GET /notifications/me — always the caller's own notification_log rows, matched by their own email as recipient (req.user carries no email claim, so the service resolves it fresh from `users` by id). */
notificationsMeRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const requested = Number(req.query.limit ?? 30);
    const limit = Number.isInteger(requested) ? Math.min(200, Math.max(1, requested)) : 30;
    const { rows, unreadCount } = await listMyNotifications(req.db! as Db, req.user!.id, limit);
    res.json({ notifications: rows, unreadCount });
  })
);

notificationsMeRouter.get(
  "/me/preferences",
  asyncHandler(async (req, res) => {
    res.json(await getMyNotificationPreferences(req.db! as Db, req.user!.id));
  })
);

notificationsMeRouter.patch(
  "/me/preferences",
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    if (body.inApp !== undefined && typeof body.inApp !== "boolean") throw AppError.badRequest("inApp must be true or false");
    if (body.email !== undefined && typeof body.email !== "boolean") throw AppError.badRequest("email must be true or false");
    const next = await updateMyNotificationPreferences(req.db! as Db, req.user!.id, {
      ...(typeof body.inApp === "boolean" ? { inApp: body.inApp } : {}),
      ...(typeof body.email === "boolean" ? { email: body.email } : {}),
    });
    res.json(next);
  })
);

notificationsMeRouter.post(
  "/me/read-all",
  asyncHandler(async (req, res) => {
    const updated = await markAllNotificationsRead(req.db! as Db, req.user!.id);
    res.json({ updated });
  })
);

/** PATCH /notifications/:id/read — marks one of the caller's own notifications read; a mismatched id (wrong company, or someone else's row) 404s rather than leaking whether it exists. */
notificationsMeRouter.patch(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw AppError.badRequest("Invalid notification id");
    const ok = await markNotificationRead(req.db! as Db, id, req.user!.id);
    if (!ok) throw AppError.notFound("Notification");
    res.status(204).send();
  })
);
