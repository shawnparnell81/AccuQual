import type { NextFunction, Request, Response } from "express";
import { logger } from "../utils/logger.js";
import { metrics } from "../modules/monitoring/metrics.js";

/** Structured per-request log line (request id, method, path, status, duration, user). Registered first in app.ts, so it also covers requests that 401 early. */
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
