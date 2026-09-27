import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { env } from "../../config/env.js";
import { roles } from "../../drizzle/schema/roles.js";
import { ssoConnections, ssoDomains } from "../../drizzle/schema/sso.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { encryptSecret } from "../company/crypto.js";
import { setRefreshCookie } from "../auth/auth.controller.js";
import { VERIFY_RECORD_PREFIX, lookupTxt } from "./dnsVerify.js";
import { SSO_COOKIE, beginAuthorization, issuerAllowed, loadProviderConfig, readFlowState, signFlowState, ssoRedirectUri } from "./oidc.js";
import { SSO_FORBIDDEN_ROLES, SsoDenied, auditDenied, findConnection, handleCallback, isFreeMailDomain } from "./sso.service.js";

// ---- Validation ------------------------------------------------------------------------------------------------------------------------------

export const saveConnectionSchema = z.object({
  displayName: z.string().min(1).max(80).default("Single sign-on"),
  issuer: z.string().url().max(500),
  clientId: z.string().min(1).max(500),
  // Left out (or blank) on an update to keep the stored secret.
  clientSecret: z.string().max(2000).optional(),
  enabled: z.boolean().default(false),
  autoProvision: z.boolean().default(false),
  defaultRoleId: z.number().int().nullable().optional(),
  enforceSso: z.boolean().default(false),
  requireVerifiedEmail: z.boolean().default(true),
});

export const addDomainSchema = z.object({
  domain: z
    .string()
    .min(3)
    .max(253)
    .transform((d) => d.trim().toLowerCase())
    .refine((d) => /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d), "Enter a domain like acme.com"),
});

// ---- Administrator: configuration -------------------------------------------------------------------------------------------------------------

function publicConnection(c: typeof ssoConnections.$inferSelect | undefined) {
  if (!c) return null;
  const { clientSecretEncrypted: _secret, ...rest } = c;
  return { ...rest, hasClientSecret: true };
}

function domainView(d: typeof ssoDomains.$inferSelect) {
  return {
    id: d.id,
    domain: d.domain,
    verified: !!d.verifiedAt,
    verifiedAt: d.verifiedAt,
    // What the company's DNS admin must publish to prove ownership.
    txtName: `${VERIFY_RECORD_PREFIX}.${d.domain}`,
    txtValue: `accuqual-verify=${d.verificationToken}`,
  };
}

export const getSsoConfig = asyncHandler(async (req: Request, res: Response) => {
  const [conn] = await req.db!.select().from(ssoConnections);
  const domains = await req.db!.select().from(ssoDomains);
  res.json({ connection: publicConnection(conn), domains: domains.map(domainView), redirectUri: ssoRedirectUri() });
});

export const saveSsoConfig = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as z.infer<typeof saveConnectionSchema>;
  const [existing] = await req.db!.select().from(ssoConnections);

  if (!issuerAllowed(input.issuer)) throw AppError.badRequest("The issuer must be an https:// URL.");
  const secretPlain = input.clientSecret?.trim();
  if (!existing && !secretPlain) throw AppError.badRequest("A client secret is required.");
  if (input.enforceSso && !input.enabled) throw AppError.badRequest("Single sign-on must be enabled before it can be required.");
  if (input.autoProvision && !input.defaultRoleId) throw AppError.badRequest("Choose the role new SSO users will get.");

  if (input.defaultRoleId) {
    const [role] = await req.db!.select().from(roles).where(eq(roles.id, input.defaultRoleId));
    if (!role) throw AppError.badRequest("That role doesn't exist.");
    if (SSO_FORBIDDEN_ROLES.has(role.name)) throw AppError.badRequest("New SSO users can't be given an administrator role. Promote them yourself after they first sign in.");
  }

  const clientSecretEncrypted = secretPlain ? encryptSecret(secretPlain) : existing!.clientSecretEncrypted;

  if (input.enabled) {
    const verified = await req.db!.select().from(ssoDomains);
    if (!verified.some((d) => d.verifiedAt)) throw AppError.badRequest("Verify at least one email domain before turning single sign-on on.");
    // Prove the provider is reachable and its settings parse before real users depend on it.
    await loadProviderConfig({ issuer: input.issuer, clientId: input.clientId, clientSecretEncrypted });
  }

  const values = {
    displayName: input.displayName,
    issuer: input.issuer.replace(/\/$/, ""),
    clientId: input.clientId,
    clientSecretEncrypted,
    enabled: input.enabled,
    autoProvision: input.autoProvision,
    defaultRoleId: input.defaultRoleId ?? null,
    enforceSso: input.enforceSso,
    requireVerifiedEmail: input.requireVerifiedEmail,
    updatedAt: new Date(),
  };
  const [saved] = existing
    ? await req.db!.update(ssoConnections).set(values).where(eq(ssoConnections.id, existing.id)).returning()
    : await req.db!.insert(ssoConnections).values({ ...values, }).returning();

  await recordAuditTrail(req.db!, {
    entityType: "SsoConnection",
    entityId: saved!.id,
    action: existing ? "update" : "create",
    changes: { enabled: saved!.enabled, enforceSso: saved!.enforceSso, autoProvision: saved!.autoProvision, issuer: saved!.issuer, secretChanged: !!secretPlain },
    performedBy: req.user?.id,
  });
  res.json(publicConnection(saved));
});

export const deleteSsoConfig = asyncHandler(async (req: Request, res: Response) => {
  const [existing] = await req.db!.select().from(ssoConnections);
  if (!existing) throw AppError.notFound("SSO connection");
  await req.db!.delete(ssoConnections).where(eq(ssoConnections.id, existing.id));
  await recordAuditTrail(req.db!, { entityType: "SsoConnection", entityId: existing.id, action: "delete", changes: { issuer: existing.issuer }, performedBy: req.user?.id });
  res.status(204).send();
});

export const addSsoDomain = asyncHandler(async (req: Request, res: Response) => {
  const { domain } = req.body as z.infer<typeof addDomainSchema>;
  if (isFreeMailDomain(domain)) throw AppError.badRequest("Free email providers can't be verified — use your organization's own domain.");
  const [dup] = await req.db!.select().from(ssoDomains).where(and(eq(ssoDomains.domain, domain)));
  if (dup) throw AppError.badRequest("That domain is already on the list.");
  const [created] = await req.db!.insert(ssoDomains).values({ domain, verificationToken: randomBytes(20).toString("hex") }).returning();
  await recordAuditTrail(req.db!, { entityType: "SsoDomain", entityId: created!.id, action: "create", changes: { domain }, performedBy: req.user?.id });
  res.status(201).json(domainView(created!));
});

export const verifySsoDomain = asyncHandler(async (req: Request, res: Response) => {
  const [row] = await req.db!.select().from(ssoDomains).where(and(eq(ssoDomains.id, Number(req.params.id))));
  if (!row) throw AppError.notFound("Domain");
  if (row.verifiedAt) return res.json(domainView(row));

  const records = await lookupTxt(`${VERIFY_RECORD_PREFIX}.${row.domain}`);
  if (!records.includes(`accuqual-verify=${row.verificationToken}`)) {
    throw AppError.badRequest(`We couldn't find the TXT record yet. Add ${VERIFY_RECORD_PREFIX}.${row.domain} = accuqual-verify=${row.verificationToken}, wait for DNS to update (this can take a few minutes), and try again.`);
  }
  const [updated] = await req.db!.update(ssoDomains).set({ verifiedAt: new Date() }).where(eq(ssoDomains.id, row.id)).returning();
  await recordAuditTrail(req.db!, { entityType: "SsoDomain", entityId: row.id, action: "status_change", changes: { action: "domain_verified", domain: row.domain }, performedBy: req.user?.id });
  res.json(domainView(updated!));
});

export const deleteSsoDomain = asyncHandler(async (req: Request, res: Response) => {
  const [row] = await req.db!.select().from(ssoDomains).where(and(eq(ssoDomains.id, Number(req.params.id))));
  if (!row) throw AppError.notFound("Domain");
  await req.db!.delete(ssoDomains).where(eq(ssoDomains.id, row.id));
  await recordAuditTrail(req.db!, { entityType: "SsoDomain", entityId: row.id, action: "delete", changes: { domain: row.domain }, performedBy: req.user?.id });
  res.status(204).send();
});

// ---- Public: the browser-facing sign-in flow ---------------------------------------------------------------------------------------------------

function loginUrl(query: Record<string, string>) {
  return `${env.FRONTEND_URL.replace(/\/$/, "")}/login?${new URLSearchParams(query).toString()}`;
}

/** Lets the login page know whether the company has SSO before it shows the button. Deliberately says nothing more. */
export const ssoDiscover = asyncHandler(async (_req: Request, res: Response) => {
  const conn = await findConnection();
  res.json({ enabled: !!conn, displayName: conn?.displayName ?? null });
});

export const ssoStart = asyncHandler(async (_req: Request, res: Response) => {
  const conn = await findConnection();
  if (!conn) return res.redirect(loginUrl({ sso_error: "not_configured" }));
  try {
    const { url, flow } = await beginAuthorization(conn);
    res.cookie(SSO_COOKIE, signFlowState(flow), { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 10 * 60_000 });
    res.redirect(url);
  } catch {
    res.redirect(loginUrl({ sso_error: "provider_error" }));
  }
});

export const ssoCallback = asyncHandler(async (req: Request, res: Response) => {
  const flow = readFlowState(req.cookies?.[SSO_COOKIE]);
  res.clearCookie(SSO_COOKIE, { path: "/" });
  if (!flow) return res.redirect(loginUrl({ sso_error: "session_expired" }));

  // The provider redirects here as a plain GET; openid-client wants the full callback URL as the browser reached it.
  const callbackUrl = new URL(ssoRedirectUri());
  for (const [k, v] of Object.entries(req.query)) if (typeof v === "string") callbackUrl.searchParams.set(k, v);

  try {
    const { session } = await handleCallback(callbackUrl, flow);
    setRefreshCookie(res, session.refreshToken);
    // The SPA's own startup refresh turns that cookie into a session.
    res.redirect(`${env.FRONTEND_URL.replace(/\/$/, "")}/`);
  } catch (err) {
    if (err instanceof SsoDenied) {
      await auditDenied(err);
      return res.redirect(loginUrl({ sso_error: err.reason }));
    }
    throw err;
  }
});
