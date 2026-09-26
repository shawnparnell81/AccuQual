import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/appError.js";
import { REFRESH_COOKIE_NAME } from "../modules/auth/auth.controller.js";
import { SSO_COOKIE } from "../modules/sso/oidc.js";

/**
 * Security-audit finding (medium): POST /auth/refresh is authenticated
 * purely by an ambient httpOnly cookie (SameSite=None in production —
 * see auth.controller.ts's own comment) — a cross-site page can trigger a
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

// ---------------------------------------------------------------------------
// App-wide guard (CodeQL js/missing-token-validation, app.ts cookie middleware)
//
// requireCsrfHeader above protects the one route we knew read a cookie. This
// guard makes that the default for EVERY route: a state-changing request that
// is carried by one of this app's own cookies — and NOT by an Authorization
// header — must present the anti-CSRF header, or it is refused before any
// handler runs. A future route that reads a cookie is therefore protected
// without anyone remembering to opt in.
//
// Why exactly this set of requests:
//  - A request with an Authorization header is not forgeable cross-site: a
//    browser never attaches that header by itself, only our own JS does.
//  - A request with none of our cookies has no ambient credential for an
//    attacker to ride (login, webhooks signed/keyed by their own headers,
//    device ingest keys, CLI/worker traffic).
//  - GET/HEAD/OPTIONS change nothing (the SSO callback is a GET whose state
//    is a signed value bound to the flow, not a session).
// What remains — cookie present, no bearer, mutating — is precisely the
// forgeable shape, and the custom header (which forces a CORS preflight that
// the origin allowlist refuses) is what stops it.
// ---------------------------------------------------------------------------
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const OWN_COOKIES = [REFRESH_COOKIE_NAME, SSO_COOKIE];

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.headers.authorization) return next();
  const carriedByOwnCookie = OWN_COOKIES.some((name) => req.cookies?.[name] !== undefined);
  if (!carriedByOwnCookie) return next();
  if (!req.headers[CSRF_HEADER]) {
    // 403 with the app's standard error body (same shape requireCsrfHeader produces).
    return next(AppError.forbidden("Missing required anti-CSRF header"));
  }
  next();
}
