import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { deviceIngestIpRateLimiter, deviceIngestRateLimiter } from "../../middleware/rateLimit.js";
import { deviceIngestSchema } from "./digital-twin.validation.js";
import { deviceIngestHandler } from "./digital-twin.controller.js";

/**
 * POST /digital-twin/device-ingest — the one digital-twin route with NO user
 * session: a PLC/sensor authenticates with its own X-Device-Key (see
 * digital-twin.deviceKeys.ts). Deliberately a separate router mounted BEFORE
 * digitalTwinRouter in routes/index.ts, whose router-level requireAuth would
 * otherwise reject a device with no login token.
 */
export const deviceIngestRouter = Router();
deviceIngestRouter.post("/", deviceIngestIpRateLimiter, deviceIngestRateLimiter, validate(deviceIngestSchema), deviceIngestHandler);
