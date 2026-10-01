import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { env } from "../../config/env.js";
import * as authService from "./auth.service.js";
import type { SignInClient } from "./signInAudit.js";
import { changeSignaturePin, setSignaturePin } from "../signatures/signaturePin.service.js";
import { decryptDeviceCookie, encryptDeviceCookie, hashTrustedDeviceToken, listTrustedDevices, revokeAllTrustedDevices, revokeTrustedDevice, TRUSTED_DEVICE_TTL_MS } from "./trustedDevice.service.js";
import { encryptRefreshCookie, REFRESH_COOKIE_NAME, refreshCookieFrom } from "./refreshCookie.js";

export { REFRESH_COOKIE_NAME };

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
export const TRUSTED_DEVICE_COOKIE_NAME = "accuqual_td";
/** Non-secret marker. The sign-in page already sends this same value in the anti-CSRF header. */
export const CSRF_MARKER_COOKIE_NAME = "accuqual_csrf";
const CSRF_MARKER_VALUE = "1";

/**
 * Host-only, path /, no Max-Age and no Expires. The browser drops these when
 * it closes and still sends them to every tab in that same browser session.
 * No Domain attribute — see setRefreshCookie.
 */
function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    // app.accuqualqms.com and api.accuqualqms.com are the same site
    // (accuqualqms.com). The browser calls the app host, and /api is
    // forwarded to the API, so a host-only Lax cookie is sent on that call.
    sameSite: "lax" as const,
    path: "/",
  };
}

/**
 * Browser-session cookie. Closing the browser drops it and signs the user
 * out. A reload, a new tab, and a typed address in the same browser still
 * send it, and the server accepts it. A browser set to continue where you
 * left off may put the cookie back; that restored cookie stays valid until
 * the 12-hour sign-in limit or 30 minutes with no activity. The value is
 * encrypted; the refresh token is not stored in the cookie as clear text.
 */
export function setRefreshCookie(res: Response, refreshToken: string) {
  res.cookie(REFRESH_COOKIE_NAME, encryptRefreshCookie(refreshToken), {
    ...sessionCookieOptions(),
    // SameSite=Lax. The browser talks to app.accuqualqms.com and the /api
    // rewrite forwards to api.accuqualqms.com, which is the same site, so
    // the cookie is sent on that call. Dev is the same idea on localhost.
    // No Domain attribute, on purpose. A host-only cookie is stored for the
    // host the browser actually called and is sent back on /api/*. Pinning
    // Domain to the API host would hide it from that call.
    // No maxAge and no expires: those attributes would keep the cookie after
    // the browser closes. The 12-hour limit is on the token, not the cookie.
  });
  res.cookie(CSRF_MARKER_COOKIE_NAME, CSRF_MARKER_VALUE, sessionCookieOptions());
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE_NAME, sessionCookieOptions());
  res.clearCookie(CSRF_MARKER_COOKIE_NAME, sessionCookieOptions());
}

/** Persistent for the same 30 days the server-side row expires. Not renewed on later sign-ins. The value written here is encrypted. SameSite is Lax because this cookie is only needed on this site's own sign-in request. */
export function setTrustedDeviceCookie(res: Response, token: string) {
  res.cookie(TRUSTED_DEVICE_COOKIE_NAME, encryptDeviceCookie(token), {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TRUSTED_DEVICE_TTL_MS,
  });
}

function clearTrustedDeviceCookie(res: Response) {
  res.clearCookie(TRUSTED_DEVICE_COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

function trustedDeviceCookie(req: Request): string | undefined {
  const value = req.cookies?.[TRUSTED_DEVICE_COOKIE_NAME];
  if (typeof value !== "string" || value.length === 0) return undefined;
  return decryptDeviceCookie(value);
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
  setRefreshCookie(res, session.refreshToken);
  if (session.trustedDeviceToken) setTrustedDeviceCookie(res, session.trustedDeviceToken);
  res.json(withoutRefreshToken(session as FinishedSession & Record<string, unknown>));
}

function signInClient(req: Request): SignInClient {
  return { ip: req.ip, userAgent: req.get("user-agent") };
}

export const loginHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSession(res, await authService.login({ ...req.body, trustedDeviceToken: trustedDeviceCookie(req), client: signInClient(req) }));
});

export const mfaVerifyHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSession(res, await authService.verifyMfaLogin(req.body.mfaToken, req.body.code, req.body.rememberMe === true, req.body.trustDevice === true, req.get("user-agent"), signInClient(req)));
});

export const mfaEnrollStartHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await authService.startEnrollmentWithToken(req.body.mfaToken));
});

export const mfaEnrollConfirmHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.confirmEnrollmentWithToken(req.body.mfaToken, req.body.code, req.body.rememberMe === true, req.body.trustDevice === true, req.get("user-agent"), signInClient(req));
  setRefreshCookie(res, result.refreshToken);
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

/** Clears the restored sign-in cookies and revokes that refresh token. Does not clear the trusted-browser cookie. */
export const endBrowserSessionHandler = asyncHandler(async (req: Request, res: Response) => {
  await authService.endBrowserSession(refreshCookieFrom(req));
  clearRefreshCookie(res);
  res.status(204).send();
});

export const refreshHandler = asyncHandler(async (req: Request, res: Response) => {
  const token = refreshCookieFrom(req);
  if (!token) throw AppError.unauthorized("Missing refresh token");

  const result = await authService.refresh(token);
  setRefreshCookie(res, result.refreshToken);
  res.json(withoutRefreshToken(result));
});

export const logoutHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw AppError.unauthorized();
  await authService.logout(req.user.id, signInClient(req));
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

export const setSignaturePinHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw AppError.unauthorized();
  await setSignaturePin(req.user.id, req.body.pin, req.body.confirmPin);
  res.json({ pinSet: true });
});

export const changeSignaturePinHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw AppError.unauthorized();
  await changeSignaturePin(req.user.id, req.body.currentPin, req.body.pin, req.body.confirmPin);
  res.json({ pinSet: true });
});

/** Replaces the refresh cookie so this browser stays signed in, and clears the trusted-device cookie because every device was just forgotten. */
export const changePasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw AppError.unauthorized();
  const result = await authService.changePassword(req.user.id, req.body.currentPassword, req.body.newPassword, refreshCookieFrom(req));
  setRefreshCookie(res, result.refreshToken);
  clearTrustedDeviceCookie(res);
  res.json(withoutRefreshToken(result));
});
