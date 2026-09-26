import type { Request, RequestHandler } from "express";
import { createPublicKey, X509Certificate, type KeyObject } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { logger } from "../utils/logger.js";

/**
 * Cloudflare Access JWT check for the private Render deploy.
 *
 * Access sits on app.accuqualqms.com only. The static site rewrites /api/*
 * to api.accuqualqms.com, and that rewrite cannot complete an Access login,
 * so the API hostname itself is not behind Access. This middleware is what
 * stops a direct call to the API: when both env vars are set, every route
 * except the health checks must present the app's Access JWT.
 *
 * The token is the Cf-Access-Jwt-Assertion header (what Cloudflare sends to
 * the first origin, and what a Worker fallback copies) or, if that header
 * is absent, the CF_Authorization cookie (what the browser sends on the
 * same-origin /api request, if the rewrite forwards Cookie).
 */

const CERTS_TTL_MS = 10 * 60 * 1000;
const EXEMPT_PATHS = new Set(["/health", "/health/live"]);

export interface AccessCerts {
  keys?: Array<{ kid?: string; kty?: string; n?: string; e?: string }>;
  public_certs?: Array<{ kid?: string; cert?: string }>;
}

export interface AccessGateConfig {
  teamDomain: string;
  audience: string;
}

type CertLoader = (url: string) => Promise<AccessCerts>;

interface CachedCerts {
  fetchedAt: number;
  byKid: Map<string, KeyObject>;
}

const certCache = new Map<string, CachedCerts>();

export function resetAccessCertCache(): void {
  certCache.clear();
}

/** https://<team>.cloudflareaccess.com with no path and no trailing slash. */
export function normalizeTeamDomain(raw: string): string {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  if (url.protocol !== "https:" || !url.hostname.includes(".")) {
    throw new Error("CF_ACCESS_TEAM_DOMAIN must be an https hostname");
  }
  return `https://${url.host}`;
}

export function extractAccessToken(req: Request): string | null {
  const header = req.headers["cf-access-jwt-assertion"];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (typeof fromHeader === "string" && fromHeader.length > 0) return fromHeader;
  const cookie = req.cookies?.CF_Authorization;
  if (typeof cookie === "string" && cookie.length > 0) return cookie;
  return null;
}

function keyFromJwk(jwk: { kty?: string; n?: string; e?: string }): KeyObject | null {
  if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) return null;
  try {
    return createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
  } catch {
    return null;
  }
}

function keyFromPem(cert: string): KeyObject | null {
  const pem = cert.includes("BEGIN CERTIFICATE")
    ? cert
    : `-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----\n`;
  try {
    return new X509Certificate(pem).publicKey;
  } catch {
    return null;
  }
}

export function indexAccessCerts(body: AccessCerts): Map<string, KeyObject> {
  const byKid = new Map<string, KeyObject>();
  for (const jwk of body.keys ?? []) {
    if (!jwk.kid) continue;
    const key = keyFromJwk(jwk);
    if (key) byKid.set(jwk.kid, key);
  }
  for (const cert of body.public_certs ?? []) {
    if (!cert.kid || !cert.cert || byKid.has(cert.kid)) continue;
    const key = keyFromPem(cert.cert);
    if (key) byKid.set(cert.kid, key);
  }
  return byKid;
}

async function loadKeys(teamDomain: string, loader: CertLoader, force: boolean): Promise<Map<string, KeyObject>> {
  const url = `${teamDomain}/cdn-cgi/access/certs`;
  const existing = certCache.get(url);
  if (!force && existing && Date.now() - existing.fetchedAt < CERTS_TTL_MS) {
    return existing.byKid;
  }
  const body = await loader(url);
  const byKid = indexAccessCerts(body);
  if (byKid.size === 0) {
    throw new Error("Cloudflare Access certs response contained no usable keys");
  }
  certCache.set(url, { fetchedAt: Date.now(), byKid });
  return byKid;
}

function verifyWithKeys(token: string, keys: Map<string, KeyObject>, kid: string, issuer: string, audience: string): boolean {
  const preferred = keys.get(kid);
  const ordered = preferred ? [preferred, ...[...keys.values()].filter((key) => key !== preferred)] : [...keys.values()];
  for (const key of ordered) {
    try {
      jwt.verify(token, key, { algorithms: ["RS256"], issuer, audience, clockTolerance: 30 });
      return true;
    } catch {
      // Try the next cert. A rotated kid can still be in the set under another id.
    }
  }
  return false;
}

export async function verifyAccessJwt(options: {
  token: string;
  teamDomain: string;
  audience: string;
  loadCerts: CertLoader;
}): Promise<void> {
  const decoded = jwt.decode(options.token, { complete: true });
  if (!decoded || typeof decoded === "string" || decoded.header.alg !== "RS256" || !decoded.header.kid) {
    throw AppError.forbidden("Cloudflare Access token is not valid");
  }
  const issuer = normalizeTeamDomain(options.teamDomain);
  let keys: Map<string, KeyObject>;
  try {
    keys = await loadKeys(issuer, options.loadCerts, false);
    if (!keys.has(decoded.header.kid)) {
      keys = await loadKeys(issuer, options.loadCerts, true);
    }
  } catch (err) {
    logger.warn("Cloudflare Access certs unavailable", { message: err instanceof Error ? err.message : "unknown" });
    throw AppError.forbidden("Cloudflare Access token is not valid");
  }
  if (!verifyWithKeys(options.token, keys, decoded.header.kid, issuer, options.audience)) {
    throw AppError.forbidden("Cloudflare Access token is not valid");
  }
}

const defaultLoader: CertLoader = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) {
    throw new Error(`Cloudflare Access certs request failed: ${response.status}`);
  }
  return (await response.json()) as AccessCerts;
};

type GateState = { enabled: false } | { enabled: true; teamDomain: string; audience: string } | { enabled: true; misconfigured: true };

function resolveGate(explicit: AccessGateConfig | null | undefined, useExplicit: boolean): GateState {
  const teamDomain = useExplicit ? explicit?.teamDomain : env.CF_ACCESS_TEAM_DOMAIN;
  const audience = useExplicit ? explicit?.audience : env.CF_ACCESS_AUD;
  if (!teamDomain || !audience) return { enabled: false };
  try {
    return { enabled: true, teamDomain: normalizeTeamDomain(teamDomain), audience: audience.trim() };
  } catch {
    return { enabled: true, misconfigured: true };
  }
}

export function cloudflareAccessGate(options?: { config?: AccessGateConfig | null; loadCerts?: CertLoader }): RequestHandler {
  const loadCerts = options?.loadCerts ?? defaultLoader;
  const useExplicit = options !== undefined && "config" in options;
  return asyncHandler(async (req, _res, next) => {
    if (EXEMPT_PATHS.has(req.path)) return next();
    const gate = resolveGate(options?.config, useExplicit);
    if (!gate.enabled) return next();
    if ("misconfigured" in gate) {
      throw AppError.forbidden("Cloudflare Access is misconfigured");
    }
    const token = extractAccessToken(req);
    if (!token) {
      throw AppError.forbidden("Cloudflare Access token is required");
    }
    await verifyAccessJwt({ token, teamDomain: gate.teamDomain, audience: gate.audience, loadCerts });
    next();
  });
}
