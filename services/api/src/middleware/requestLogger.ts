import type { NextFunction, Request, Response } from "express";
import { logger } from "../utils/logger.js";

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
    logger.info("request", {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      tenantId: req.tenantId ?? null,
      userId: req.user?.id ?? null,
    });
  });

  next();
}
