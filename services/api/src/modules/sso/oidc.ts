import jwt from "jsonwebtoken";
import * as oidc from "openid-client";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/appError.js";
import type { SsoConnection } from "../../drizzle/schema/sso.js";
import { decryptSecret } from "../company/crypto.js";

// A thin layer over the vetted `openid-client` library: discovery, PKCE
// authorization-code flow, and ID-token validation (signature, issuer,
// audience, expiry, nonce, state) are all done by the library — none of that
// is hand-rolled here.

/** The address the identity provider sends the browser back to. Register exactly this URL with the provider. */
export function ssoRedirectUri(): string {
  const base = env.API_PUBLIC_URL ?? `${env.FRONTEND_URL.replace(/\/$/, "")}/api`;
  return `${base.replace(/\/$/, "")}/auth/sso/callback`;
}

/** https only — except a localhost provider outside production, which makes local testing possible. */
export function issuerAllowed(issuer: string): boolean {
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && env.NODE_ENV !== "production" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

const configCache = new Map<string, { config: oidc.Configuration; at: number }>();
const CONFIG_TTL_MS = 5 * 60_000;

type ConnectionForDiscovery = Pick<SsoConnection, "issuer" | "clientId" | "clientSecretEncrypted">;

/** Discovers (and briefly caches) the provider's endpoints and keys. */
export async function loadProviderConfig(conn: ConnectionForDiscovery, cacheKey?: string): Promise<oidc.Configuration> {
  if (!issuerAllowed(conn.issuer)) throw AppError.badRequest("The issuer must be an https:// URL.");
  const key = cacheKey ? `${cacheKey}:${conn.issuer}:${conn.clientId}:${conn.clientSecretEncrypted.slice(-12)}` : null;
  const hit = key ? configCache.get(key) : undefined;
  if (hit && Date.now() - hit.at < CONFIG_TTL_MS) return hit.config;
  try {
    const insecure = new URL(conn.issuer).protocol === "http:";
    const config = await oidc.discovery(new URL(conn.issuer), conn.clientId, decryptSecret(conn.clientSecretEncrypted), undefined, insecure ? { execute: [oidc.allowInsecureRequests] } : undefined);
    if (key) configCache.set(key, { config, at: Date.now() });
    return config;
  } catch {
    throw AppError.badRequest("Couldn't read this provider's OpenID configuration. Check the issuer URL — it should serve /.well-known/openid-configuration.");
  }
}

// ---- Transient state carried across the redirect to the provider and back --------------------------------------------------------------------

export const SSO_COOKIE = "accuqual_sso";
const ssoStateSecret = `${env.JWT_ACCESS_SECRET}:sso-state`;

export interface SsoFlowState {
  cid: number;
  state: string;
  nonce: string;
  verifier: string;
}

export function signFlowState(flow: SsoFlowState): string {
  return jwt.sign(flow, ssoStateSecret, { expiresIn: "10m" });
}

export function readFlowState(token: string | undefined): SsoFlowState | null {
  if (!token) return null;
  try {
    const p = jwt.verify(token, ssoStateSecret) as jwt.JwtPayload & SsoFlowState;
    return { cid: p.cid, state: p.state, nonce: p.nonce, verifier: p.verifier };
  } catch {
    return null;
  }
}

/** Builds the provider's authorization URL (authorization-code flow with PKCE, state and nonce). */
export async function beginAuthorization(conn: SsoConnection): Promise<{ url: string; flow: SsoFlowState }> {
  const config = await loadProviderConfig(conn, String(conn.id));
  const verifier = oidc.randomPKCECodeVerifier();
  const flow: SsoFlowState = { cid: conn.id, state: oidc.randomState(), nonce: oidc.randomNonce(), verifier };
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: ssoRedirectUri(),
    scope: "openid email profile",
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state: flow.state,
    nonce: flow.nonce,
  });
  return { url: url.href, flow };
}

export interface SsoClaims {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
}

/** Exchanges the returned code and validates the ID token; throws if anything about it is off. */
export async function completeAuthorization(conn: SsoConnection, callbackUrl: URL, flow: SsoFlowState): Promise<SsoClaims> {
  const config = await loadProviderConfig(conn, String(conn.id));
  const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: flow.verifier,
    expectedState: flow.state,
    expectedNonce: flow.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims?.sub) throw new Error("ID token had no subject");
  return {
    sub: claims.sub,
    email: typeof claims.email === "string" ? claims.email.toLowerCase() : undefined,
    emailVerified: claims.email_verified === true,
    name: typeof claims.name === "string" ? claims.name : undefined,
  };
}
