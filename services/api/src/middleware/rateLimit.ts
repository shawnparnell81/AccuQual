import net from "node:net";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import rateLimit, { MemoryStore } from "express-rate-limit";
import { env } from "../config/env.js";
import { verifyRefreshToken } from "../utils/jwt.js";
import { openRefreshCookie } from "../modules/auth/refreshCookie.js";
import { registerRefreshFlight } from "../modules/auth/refreshFlight.js";

function normalizeIp(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  return (mapped?.[1] ?? ip).toLowerCase();
}

/**
 * The address of the person, not the proxy in front of the API.
 * Cloudflare sets CF-Connecting-IP to one client address. Anything else
 * (a list, or a value that is not an IP) is ignored so it cannot pick the
 * bucket. With that header absent, req.ip is the address Express already
 * resolved with trust proxy set to 1.
 */
export function visitorIp(req: Request): string {
  const cf = req.header("cf-connecting-ip")?.trim();
  if (cf && net.isIP(cf)) return normalizeIp(cf);
  if (req.ip && net.isIP(req.ip)) return normalizeIp(req.ip);
  return "unknown";
}

const DEVICE_INGEST_PATH = "/digital-twin/device-ingest";

/**
 * Session renewal is not part of the per-address API budget. A busy page
 * (or a whole office behind one address) used to spend that budget, and the
 * next silent renewal came back 429. Renewal has its own per-person limiter.
 */
export function skipApiRateLimit(req: Request): boolean {
  return req.path.startsWith(DEVICE_INGEST_PATH) || req.path === "/auth/refresh";
}

export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // One integration file walks every saved form. That is more than a person's 15-minute budget.
  limit: env.NODE_ENV === "test" ? 100_000 : 600,
  standardHeaders: true,
  legacyHeaders: false,
  // Devices are throttled by the two dedicated limiters below instead: a
  // whole plant's sensors usually share one public IP, so the per-IP budget
  // meant for people would cut them off almost immediately.
  skip: (req) => skipApiRateLimit(req),
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Integration tests sign in dozens of times from one address; the per-account lockout is what they exercise.
  limit: env.NODE_ENV === "test" ? 100_000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  // Own in-memory counter. This deploy has no Redis; the Render API is one instance.
  store: new MemoryStore(),
  keyGenerator: (req) => `auth:${visitorIp(req)}`,
  message: { error: "TooManyRequests", message: "Too many auth attempts, try again later" },
});

/**
 * How often one person may renew a session. Separate from the sign-in limit:
 * an active browser renews on its own, and a whole office used to share one
 * address-wide budget with password guesses. 60 per 15 minutes is far above
 * normal use (about once per access-token lifetime) and still stops a loop.
 */
export const REFRESH_RATE_LIMIT_MAX = 60;
export const REFRESH_RATE_WINDOW_MS = 15 * 60 * 1000;

const REFRESH_COOKIE = "accuqual_rt";

/**
 * Count renewals per person, not per IP address. The user id is taken from a
 * signature check — a forged cookie cannot pick its own bucket. A missing or
 * invalid cookie falls back to the caller's address. The id is the user, not
 * the token id: each successful renewal rotates that id, and keying on it
 * would hand every renewal a fresh budget.
 */
export function refreshRateLimitKey(req: Request): string {
  const raw = req.cookies?.[REFRESH_COOKIE];
  const token = openRefreshCookie(typeof raw === "string" ? raw : undefined) ?? "";
  try {
    const sub = verifyRefreshToken(token).sub;
    if (sub) return `refresh-user-${sub}`;
  } catch {
    // missing, unsigned, expired, or tampered — count by address instead
  }
  return `refresh-ip-${req.ip ?? "unknown"}`;
}

export function createRefreshRateLimiter(options?: { limit?: number; windowMs?: number }) {
  return rateLimit({
    windowMs: options?.windowMs ?? REFRESH_RATE_WINDOW_MS,
    limit: options?.limit ?? (env.NODE_ENV === "test" ? 100_000 : REFRESH_RATE_LIMIT_MAX),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => refreshRateLimitKey(req),
    // A new MemoryStore per limiter. express-rate-limit refuses a shared store,
    // and nothing here talks to Redis (this deploy does not run one).
    store: new MemoryStore(),
    message: { error: "TooManyRequests", message: "Too many session renewals, try again shortly" },
  });
}

export const refreshRateLimiter = createRefreshRateLimiter();

/**
 * Counts one renewal per burst. A follower that joins a renewal already in
 * flight does not spend a slot, so several tabs or a pile of parallel 401s
 * cannot 429 themselves.
 */
export function createRefreshCoordinator(limiter: RequestHandler = refreshRateLimiter): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = registerRefreshFlight(req, res, refreshRateLimitKey(req));
    if (role === "follower") return next();
    return limiter(req, res, next);
  };
}

export const coordinateRefreshRateLimit = createRefreshCoordinator();

/** Per device (the id half of X-Device-Key): 120 readings/minute, i.e. one every 500 ms. */
export const deviceIngestRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `device:${req.header("x-device-key")?.split(".")[0] ?? req.ip}`,
  message: { error: "TooManyRequests", message: "Device is sending readings too fast" },
});

/** Per IP, generous enough for a plant full of devices behind one address — this one mainly bounds unauthenticated guessing. */
export const deviceIngestIpRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 3000,
  standardHeaders: true,
  legacyHeaders: false,
});
