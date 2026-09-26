import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { env } from "../../config/env.js";
import * as authService from "./auth.service.js";
import { hashTrustedDeviceToken, listTrustedDevices, revokeAllTrustedDevices, revokeTrustedDevice, TRUSTED_DEVICE_TTL_MS } from "./trustedDevice.service.js";

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
// private Render deploy keeps the same browser path (VITE_API_BASE_URL=/api)
// via the static-site rewrite, and docker-compose still uses the nginx
// template, so "/" is the path that works in both places.
export const REFRESH_COOKIE_NAME = "accuqual_rt";
export const TRUSTED_DEVICE_COOKIE_NAME = "accuqual_td";
/** Non-secret marker. The sign-in page already sends this same value in the anti-CSRF header. */
export const CSRF_MARKER_COOKIE_NAME = "accuqual_csrf";
const CSRF_MARKER_VALUE = "1";

/** Host-only, path /, SameSite matching the refresh cookie. No Domain attribute — see setRefreshCookie. */
function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: (env.NODE_ENV === "production" ? "none" : "lax") as "none" | "lax",
    path: "/",
  };
}

/** Persistent until the sign-in's absolute end, so closing the browser does not sign the user out. Max-Age is the time left, not a fresh 12 hours. */
export function setRefreshCookie(res: Response, refreshToken: string, sessionExpiresAt: Date) {
  const maxAge = Math.max(0, sessionExpiresAt.getTime() - Date.now());
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    ...sessionCookieOptions(),
    // SameSite=None (only valid with Secure, which production already sets)
    // still sends the cookie on the same-origin /api path used by compose
    // (nginx) and by the private Render deploy (static-site rewrite). It
    // also keeps a credentialed call working if the browser ever talks to
    // the API on its own origin.
    // Dev runs both over plain http on localhost, where SameSite=Lax still
    // works and doesn't require https.
    // No Domain attribute, on purpose. The browser talks to
    // app.accuqualqms.com and the /api rewrite forwards to
    // api.accuqualqms.com. A host-only cookie is stored for the host the
    // browser actually called and is sent back on /api/*. Pinning Domain to
    // the API host would hide it from that call.
    maxAge,
  });
  res.cookie(CSRF_MARKER_COOKIE_NAME, CSRF_MARKER_VALUE, { ...sessionCookieOptions(), maxAge });
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE_NAME, sessionCookieOptions());
  res.clearCookie(CSRF_MARKER_COOKIE_NAME, sessionCookieOptions());
}

/**
 * Persistent for the same 30 days the server-side row expires. Not renewed on later sign-ins.
 * The value is a random bearer secret. The database stores only its SHA-256 hash, so a copy of
 * the database is not enough to skip the authenticator code. The cookie has to hold that secret
 * or the browser could not present it. Encrypting it would not help: whoever has the cookie can
 * still send it back, and the server would decrypt it. httpOnly is set on this call.
 * Secure is on in production. Local sign-in is plain HTTP, which cannot use the Secure flag.
 */
export function setTrustedDeviceCookie(res: Response, token: string) {
  const sameSite = env.NODE_ENV === "production" ? "none" : "lax";
  // codeql[js/clear-text-storage-of-sensitive-data]
  // codeql[js/clear-text-cookie]
  res.cookie(TRUSTED_DEVICE_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite,
    path: "/",
    maxAge: TRUSTED_DEVICE_TTL_MS,
  });
}

function clearTrustedDeviceCookie(res: Response) {
  res.clearCookie(TRUSTED_DEVICE_COOKIE_NAME, sessionCookieOptions());
}

function trustedDeviceCookie(req: Request): string | undefined {
  const value = req.cookies?.[TRUSTED_DEVICE_COOKIE_NAME];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Strips the refresh token — and its jti (security-audit finding: refresh
 * token rotation/reuse tracking, see refreshTokens.ts) — out of a service
 * result before it's ever serialized into a response body. The jti is
 * auth.service.ts's own internal bookkeeping key for the refresh_tokens
 * table; it has no reason to ever reach the client.
 */
function withoutRefreshToken<T extends { refreshToken: string; refreshJti?: string; remember?: boolean; trustedDeviceToken?: string; sessionExpiresAt?: Date }>(result: T) {
  const { refreshToken: _refreshToken, refreshJti: _refreshJti, remember: _remember, trustedDeviceToken: _trustedDeviceToken, sessionExpiresAt: _sessionExpiresAt, ...rest } = result;
  return rest;
}

type FinishedSession = {
  refreshToken: string;
  refreshJti?: string;
  remember?: boolean;
  trustedDeviceToken?: string;
  sessionExpiresAt: Date;
};

/** A finished sign-in sets the refresh cookie; a pending second step (or forced enrollment) issues nothing but its short-lived challenge token. */
function sendSession(res: Response, result: Awaited<ReturnType<typeof authService.login>> | (FinishedSession & Record<string, unknown>)) {
  if ("mfaRequired" in result || "mfaEnrollmentRequired" in result) {
    res.json(result);
    return;
  }
  const session = result as FinishedSession;
  setRefreshCookie(res, session.refreshToken, session.sessionExpiresAt);
  if (session.trustedDeviceToken) setTrustedDeviceCookie(res, session.trustedDeviceToken);
  res.json(withoutRefreshToken(session as FinishedSession & Record<string, unknown>));
}

export const loginHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSession(res, await authService.login({ ...req.body, trustedDeviceToken: trustedDeviceCookie(req) }));
});

export const mfaVerifyHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSession(res, await authService.verifyMfaLogin(req.body.mfaToken, req.body.code, req.body.rememberMe === true, req.body.trustDevice === true, req.get("user-agent")));
});

export const mfaEnrollStartHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await authService.startEnrollmentWithToken(req.body.mfaToken));
});

export const mfaEnrollConfirmHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.confirmEnrollmentWithToken(req.body.mfaToken, req.body.code, req.body.rememberMe === true, req.body.trustDevice === true, req.get("user-agent"));
  setRefreshCookie(res, result.refreshToken, result.sessionExpiresAt);
  if (result.trustedDeviceToken) setTrustedDeviceCookie(res, result.trustedDeviceToken);
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

export const listTrustedDevicesHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json({ devices: await listTrustedDevices(req.user!.id, trustedDeviceCookie(req)) });
});

export const revokeTrustedDeviceHandler = asyncHandler(async (req: Request, res: Response) => {
  const deviceId = Number(req.params.id);
  if (!Number.isInteger(deviceId) || deviceId <= 0) throw AppError.notFound("Trusted device");
  const revoked = await revokeTrustedDevice(req.user!.id, deviceId);
  if (!revoked) throw AppError.notFound("Trusted device");
  const current = trustedDeviceCookie(req);
  if (current && hashTrustedDeviceToken(current) === revoked.tokenHash) clearTrustedDeviceCookie(res);
  res.status(204).send();
});

export const revokeAllTrustedDevicesHandler = asyncHandler(async (req: Request, res: Response) => {
  await revokeAllTrustedDevices(req.user!.id, "forgotten_by_user", req.user!.id);
  clearTrustedDeviceCookie(res);
  res.status(204).send();
});

export const refreshHandler = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!token) throw AppError.unauthorized("Missing refresh token");

  const result = await authService.refresh(token);
  setRefreshCookie(res, result.refreshToken, result.sessionExpiresAt);
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
