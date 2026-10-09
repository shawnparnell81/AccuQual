import type { Request } from "express";
import { visitorIp } from "../../middleware/rateLimit.js";
import type { SignInClient } from "./signInAudit.js";

/**
 * The address Express resolved with trust proxy set to 1 (Render's one hop),
 * unless Cloudflare sent a single client address in CF-Connecting-IP.
 * A list in that header is ignored so it cannot pick the address.
 */
export function signInClientFromRequest(req: Request): SignInClient {
  const ip = visitorIp(req);
  return {
    ip: !ip || ip === "unknown" ? null : ip,
    userAgent: req.get("user-agent") ?? null,
    platformVersion: req.get("sec-ch-ua-platform-version") ?? null,
  };
}
