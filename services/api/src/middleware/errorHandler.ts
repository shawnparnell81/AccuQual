import type { ErrorRequestHandler, RequestHandler, Request } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/appError.js";
import { logger } from "../utils/logger.js";
import { pool } from "../db/index.js";
import { recordAuditTrailStandalone } from "../modules/audit-trail/audit-trail.service.js";

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
  ncr: "ncr",
  capa: "capa",
  quality: "discrepancy_investigation",
  audits: "Audit",
  equipment: "Equipment",
  documents: "Document",
  training: "TrainingAssignment",
  suppliers: "Supplier",
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
 */
function logFailedTransition(req: Request, err: unknown, statusCode: number): void {
  if (!STATE_CHANGING_METHODS.has(req.method) || req.tenantId === undefined) return;
  const target = inferFailedTransitionTarget(req);
  if (!target) return;

  const errorMessage = err instanceof ZodError ? "Request failed validation" : err instanceof Error ? err.message : "Unknown error";

  recordAuditTrailStandalone(pool, {
    tenantId: req.tenantId,
    entityType: target.entityType,
    entityId: target.entityId,
    action: "transition_failed",
    changes: {
      attemptedTransition: `${req.method} ${req.path}`,
      errorMessage,
      statusCode,
      userRole: req.user?.roleName ?? null,
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
    });
  }

  if (err instanceof AppError) {
    if (!err.isOperational) {
      logger.error(err.message, { stack: err.stack });
    }
    logFailedTransition(req, err, err.statusCode);
    return res.status(err.statusCode).json({
      error: err.name,
      message: err.message,
      details: err.details,
    });
  }

  logger.error("Unhandled error", { message: err?.message, stack: err?.stack, path: req.path });
  logFailedTransition(req, err, 500);
  return res.status(500).json({
    error: "InternalServerError",
    message: "An unexpected error occurred",
  });
};

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: "NotFound", message: `No route for ${req.method} ${req.path}` });
};
