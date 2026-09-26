import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { withDb } from "../../lib/requestDb.js";
import { validate } from "../../middleware/validate.js";
import { listErpSyncErrorsQuerySchema } from "./erpSyncErrors.validation.js";
import { listErrorsHandler, getErrorHandler, resolveErrorHandler, retryErrorHandler } from "./erpSyncErrors.controller.js";

/**
 * ERP Sync Error Dashboard — admin-only, same gate as erpPresets.routes.ts
 * (mirrors ErpSyncSettings, not a department ResourceKey). Mounted at "/erp"
 * but registered before erpRouter in routes/index.ts, and every middleware
 * is applied per-ROUTE rather than via a router-level `.use()` — the exact
 * regression erpPresets.routes.ts's own comment documents (a `.use()` here
 * would wrongly gate erpRouter's unrelated /erp/* routes too).
 */
export const erpSyncErrorsRouter = Router();
const gate = [requireAuth, withDb, requireRole("admin")];

erpSyncErrorsRouter.get("/errors", ...gate, validate(listErpSyncErrorsQuerySchema, "query"), listErrorsHandler);
erpSyncErrorsRouter.get("/errors/:id", ...gate, getErrorHandler);
erpSyncErrorsRouter.post("/errors/:id/resolve", ...gate, resolveErrorHandler);
erpSyncErrorsRouter.post("/errors/:id/retry", ...gate, retryErrorHandler);
