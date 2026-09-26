import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { env } from "../../config/env.js";
import { REMEMBER_ME_TTL_MS } from "../../utils/jwt.js";
import * as authService from "./auth.service.js";

// Full-System Audit finding B2: the refresh token used to be a plain field
// in the login/refresh JSON response, which the frontend then had
// nowhere safe to keep except localStorage (readable by any script on the
// page — the exact thing an XSS bug would go looking for). It now never
// reaches frontend JS at all: httpOnly means document.cookie can't see it
// either.
//
// path MUST be "/" rather than a narrower "/auth" — confirmed live against
// this repo's own docker-compose stack, not just reasoned about: apps/web's
// nginx template proxies "/api/*" to this service with the "/api" prefix
// stripped, so the browser's own view of the login/refresh URL is
// "/api/auth/login", not "/auth/login". A Path=/auth cookie only ever
// matches a browser-visible path starting with "/auth" — under that proxy
// it silently never gets sent back on the very next refresh call. The
// private Render deploy uses that same proxy (VITE_API_BASE_URL=/api), so
// "/" is the path that works there too.
export const REFRESH_COOKIE_NAME = "accuqual_rt";

/** `remember` (the "Remember me" tick) makes it a persistent cookie; without it the cookie ends when the browser closes. */
export function setRefreshCookie(res: Response, refreshToken: string, remember = false) {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    // SameSite=None (only valid with Secure, which production already sets)
    // still sends the cookie on the same-origin /api proxy used by compose
    // and by the private Render deploy. It also keeps a credentialed call
    // working if the browser ever talks to the API on its own origin.
    // Dev runs both over plain http on localhost, where SameSite=Lax still
    // works and doesn't require https.
    sameSite: env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
    ...(remember ? { maxAge: REMEMBER_ME_TTL_MS } : {}),
  });
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
  });
}

/**
 * Strips the refresh token — and its jti (security-audit finding: refresh
 * token rotation/reuse tracking, see refreshTokens.ts) — out of a service
 * result before it's ever serialized into a response body. The jti is
 * auth.service.ts's own internal bookkeeping key for the refresh_tokens
 * table; it has no reason to ever reach the client.
 */
function withoutRefreshToken<T extends { refreshToken: string; refreshJti?: string; remember?: boolean }>(result: T) {
  const { refreshToken: _refreshToken, refreshJti: _refreshJti, remember: _remember, ...rest } = result;
  return rest;
}

/** A finished sign-in sets the refresh cookie; a pending second step (or forced enrollment) issues nothing but its short-lived challenge token. */
function sendSession(res: Response, result: Awaited<ReturnType<typeof authService.login>>) {
  if ("mfaRequired" in result || "mfaEnrollmentRequired" in result) {
    res.json(result);
    return;
  }
  setRefreshCookie(res, result.refreshToken, result.remember);
  res.json(withoutRefreshToken(result));
}

export const loginHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSession(res, await authService.login(req.body));
});

export const mfaVerifyHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSession(res, await authService.verifyMfaLogin(req.body.mfaToken, req.body.code, req.body.rememberMe === true));
});

export const mfaEnrollStartHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await authService.startEnrollmentWithToken(req.body.mfaToken));
});

export const mfaEnrollConfirmHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.confirmEnrollmentWithToken(req.body.mfaToken, req.body.code, req.body.rememberMe === true);
  setRefreshCookie(res, result.refreshToken, result.remember);
  res.json(withoutRefreshToken(result));
});

export const mfaStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await authService.mfaStatus(req.user!.id));
});

export const mfaSetupHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await authService.startMfaSetup(req.user!.id));
});

export const mfaEnableHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await authService.enableMfa(req.user!.id, req.body.code));
});

export const mfaDisableHandler = asyncHandler(async (req: Request, res: Response) => {
  await authService.disableMfa(req.user!.id, req.body.password, req.body.code);
  res.status(204).send();
});

export const mfaRecoveryCodesHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await authService.newRecoveryCodes(req.user!.id, req.body.password, req.body.code));
});

export const refreshHandler = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!token) throw AppError.unauthorized("Missing refresh token");

  const result = await authService.refresh(token);
  setRefreshCookie(res, result.refreshToken, result.remember);
  res.json(withoutRefreshToken(result));
});

export const logoutHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw AppError.unauthorized();
  await authService.logout(req.user.id);
  clearRefreshCookie(res);
  res.status(204).send();
});

export const meHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw AppError.unauthorized();
  const user = await authService.me(req.user.id);
  res.json(user);
});

// Always the same generic response regardless of whether the email exists —
// see authService.forgotPassword's own comment on why.
export const forgotPasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  await authService.forgotPassword(req.body.email);
  res.json({ message: "If that email is registered, a password reset link has been sent." });
});

export const resetPasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  await authService.resetPassword(req.body.token, req.body.newPassword);
  res.json({ message: "Password updated. You can now log in with your new password." });
});
