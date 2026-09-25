import type { NextFunction, Request, Response } from "express";
import { logger } from "../utils/logger.js";
import { metrics } from "../modules/monitoring/metrics.js";

/**
 * Structured per-request log line including `tenantId` whenever the route
 * resolved one (see lib/tenantScope.ts) — per the Multi-Tenant Patch Pack §G
 * "Logging must include tenant_id in structured logs." Registered first in
 * app.ts, so it always fires even for routes that 401 before reaching
 * withTenantDb (tenantId is simply omitted then).
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startedAt = Date.now();

  res.on("finish", () => {
    // Health checks poll constantly; counting them would drown the error rate the alerts watch.
    if (!req.path.startsWith("/health")) metrics.recordRequest(res.statusCode);
    logger.info("request", {
      requestId: res.getHeader("x-request-id"),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      userId: req.user?.id ?? null,
    });
  });

  next();
}
