import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/appError.js";

/**
 * Security-audit finding (medium): POST /auth/refresh is authenticated
 * purely by an ambient httpOnly cookie (SameSite=None in production,
 * required by the real cross-origin Render topology — see
 * auth.controller.ts's own comment) — a cross-site page can trigger a
 * "simple" cross-origin POST (no custom headers, so no CORS preflight)
 * and the browser attaches the cookie regardless of which site asked for
 * it. This doesn't need a full CSRF-token architecture: this app's CORS
 * config (app.ts) already enforces a real origin allowlist, and ANY
 * custom header on a cross-origin fetch/XHR forces the browser into a
 * preflight first — which that same allowlist then blocks for any origin
 * that isn't the real frontend. Requiring one arbitrary custom header is
 * exactly what turns "no preflight, cookie sent anyway" into "preflight
 * required, and CORS already refuses it" — a plain HTML form POST (the
 * classic no-JS CSRF vector) can never add a custom header at all, so it's
 * blocked outright regardless of CORS.
 *
 * The header's VALUE carries no secret — this isn't a token, it's a
 * mechanism for forcing the preflight. Real risk this closes: without it,
 * the new refresh-token reuse detection (refreshTokens.ts) could itself be
 * abused as a session-wide-logout trigger — a forged refresh raced against
 * the legitimate client's own pending one reads as "reuse" and revokes the
 * whole account.
 */
const CSRF_HEADER = "x-accuqual-csrf";

export function requireCsrfHeader(req: Request, _res: Response, next: NextFunction) {
  if (!req.headers[CSRF_HEADER]) {
    throw AppError.forbidden("Missing required anti-CSRF header");
  }
  next();
}
