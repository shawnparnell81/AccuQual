import type { ErrorRequestHandler, RequestHandler, Request } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/appError.js";
import { logger } from "../utils/logger.js";
import { pool } from "../db/index.js";
import { recordAuditTrailStandalone } from "../modules/audit-trail/audit-trail.service.js";
import { getRequestId } from "../modules/monitoring/requestContext.js";
import { captureError } from "../modules/monitoring/sentry.js";

const STATE_CHANGING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/**
 * First path segment -> the entityType each module's own successful-path
 * handlers already use in their recordAuditTrail() calls (see each
 * controller) — kept in sync with those, not a new naming scheme. Only
 * modules with a real workflow are listed; anything else (auth, users,
 * roles, workflow, ai, ...) is deliberately not logged here — a failed
 * login or a bad role-management request isn't a workflow transition.
 * Best-effort: this can't tell training's course-level routes from its
 * assignment-level ones the way each controller's own curated calls can —
 * see the Audit Trail Dictionary for that limitation.
 */
const ROUTE_ENTITY_TYPES: Record<string, string> = {
  // Phase 9 fix — ncr/capa/quality were still on their PRE-casing-fix
  // values ("ncr"/"capa"/"discrepancy_investigation"). Every module's own
  // successful-path recordAuditTrail calls were aligned to crudFactory's
  // casing a while back (see workflow.controller.ts's own MODULE_ENTITY_TYPES
  // comment on that fix), but this map was never updated to match — meaning
  // a FAILED ncr/capa/quality transition (400/403/500) was logged under a
  // different entityType than every successful one, making it silently
  // invisible in that record's own History tab. Confirmed via direct grep
  // of each module's real recordAuditTrail calls before fixing.
  ncr: "NCR",
  capa: "CAPA",
  quality: "Discrepancy investigation",
  audits: "Audit",
  equipment: "Equipment",
  documents: "Document",
  training: "TrainingAssignment",
  suppliers: "Supplier",
  rma: "Rma",
  "work-orders": "WorkOrder",
  // Phase 9 additions — real modules with a real transition/status concept
  // that weren't covered here before (their successful-path casing,
  // confirmed directly against each module's own recordAuditTrail calls).
  "8d": "8D Report",
  warranty: "WarrantyClaim",
  crar: "Crar",
  "rma-log": "RmaLog",
  erp: "PurchaseOrder",
  inventory: "InventoryItem",
  risk: "RiskAssessment",
};

/**
 * req.params is empty by the time a request reaches this top-level error
 * handler — Express unwinds each router's params as it exits that layer
 * while an error propagates, and this middleware sits above every router
 * (see app.ts). req.path survives intact, so the id is parsed straight out
 * of it instead: the first purely-numeric segment after the module name,
 * which correctly finds the record id whether it's the very next segment
 * (/ncr/5/close) or one further in past a literal sub-path
 * (/equipment/calibration/2/certificate, /training/assignment/7/complete).
 */
function inferFailedTransitionTarget(req: Request): { entityType: string; entityId: number } | null {
  const segments = req.path.split("/").filter(Boolean);
  const entityType = segments[0] ? ROUTE_ENTITY_TYPES[segments[0]] : undefined;
  if (!entityType) return null;

  const idSegment = segments.slice(1).find((s) => /^\d+$/.test(s));
  if (idSegment === undefined) return null; // e.g. a failed create — no existing record to attach this to yet

  return { entityType, entityId: Number(idSegment) };
}

/**
 * Fire-and-forget: logs a failed workflow transition attempt for ISO
 * traceability (see the Audit Trail Dictionary, section 4). Deliberately
 * narrow — only state-changing requests against a recognized module, with a
 * resolvable record id and tenant context, get logged; everything else is
 * silently skipped rather than guessed at. Never awaited by the caller and
 * never throws, so it can't delay or break the real error response.
 *
 * Phase 9 task 2 — "Add audit trail: 'Permission denied for workflow
 * transition.'" Before this phase, only 2 of ~15 modules (CRAR, RMA-Log)
 * ever logged a real `action: "permission_denied"` entry, each with its
 * own hand-written call site. Since EVERY state-changing request already
 * flows through this one centralized handler on a 403, this single change
 * gives every recognized module (see ROUTE_ENTITY_TYPES above) a real,
 * consistent "permission denied" entry for free — no per-module code
 * changes needed, and CRAR/RMA-Log's own existing calls are unaffected
 * (this only fires for requests that reach this top-level handler with no
 * earlier permission_denied entry already recorded).
 */
function logFailedTransition(req: Request, err: unknown, statusCode: number): void {
  if (!STATE_CHANGING_METHODS.has(req.method) || !req.user) return;
  const target = inferFailedTransitionTarget(req);
  if (!target) return;

  const errorMessage = err instanceof ZodError ? "Request failed validation" : err instanceof Error ? err.message : "Unknown error";
  const isPermissionDenied = statusCode === 403;

  recordAuditTrailStandalone(pool, {
    entityType: target.entityType,
    entityId: target.entityId,
    action: isPermissionDenied ? "permission_denied" : "transition_failed",
    changes: {
      message: isPermissionDenied ? "Permission denied for workflow transition" : undefined,
      attemptedTransition: `${req.method} ${req.path}`,
      errorMessage,
      statusCode,
      userRole: req.user?.roleName ?? null,
      userDepartment: req.user?.department ?? null,
      ...(err instanceof ZodError ? { validationDetails: err.flatten() } : {}),
    },
    performedBy: req.user?.id,
  }).catch((loggingErr) => logger.error("logFailedTransition itself failed", loggingErr));
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    logFailedTransition(req, err, 400);
    return res.status(400).json({
      error: "ValidationError",
      message: "Request failed validation",
      details: err.flatten(),
      requestId: getRequestId(),
    });
  }

  if (err instanceof AppError) {
    if (!err.isOperational) {
      logger.error(err.message, { stack: err.stack });
    }
    logFailedTransition(req, err, err.statusCode);
    if (err.statusCode >= 500) captureError(err, { path: req.path, method: req.method });
    return res.status(err.statusCode).json({
      error: err.name,
      message: err.message,
      details: err.details,
      requestId: getRequestId(),
    });
  }

  logger.error("Unhandled error", { message: err?.message, stack: err?.stack, path: req.path });
  logFailedTransition(req, err, 500);
  captureError(err, { path: req.path, method: req.method });
  return res.status(500).json({
    error: "InternalServerError",
    message: "An unexpected error occurred",
    // Quote this to support: it is on every log line and error report for this request.
    requestId: getRequestId(),
  });
};

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: "NotFound", message: `No route for ${req.method} ${req.path}`, requestId: getRequestId() });
};
