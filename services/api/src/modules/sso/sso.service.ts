import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users } from "../../drizzle/schema/users.js";
import { roles } from "../../drizzle/schema/roles.js";
import { company } from "../../drizzle/schema/company.js";
import { ssoConnections, ssoDomains, userIdentities, type SsoConnection } from "../../drizzle/schema/sso.js";
import { logger } from "../../utils/logger.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { startSessionForSsoUser } from "../auth/auth.service.js";
import { completeAuthorization, type SsoFlowState } from "./oidc.js";

/** Roles SSO may never hand out on its own: whoever controls (or spoofs) the provider must not be able to mint admins. */
export const SSO_FORBIDDEN_ROLES = new Set(["admin"]);

// Anyone can register these, so proving control of one proves nothing about an organization.
const FREE_MAIL_DOMAINS = new Set(["gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "zoho.com", "yandex.com"]);
export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL_DOMAINS.has(domain.toLowerCase());
}

/** Every way a callback can be refused, as the short code the login page turns into a message. */
export type SsoDenyReason =
  | "session_expired"
  | "provider_error"
  | "no_email"
  | "email_not_verified"
  | "domain_not_allowed"
  | "no_account"
  | "account_disabled"
  | "not_configured";

export class SsoDenied extends Error {
  constructor(public readonly reason: SsoDenyReason, public readonly detail?: Record<string, unknown>) {
    super(reason);
  }
}

async function audit(userId: number, changes: Record<string, unknown>) {
  await recordAuditTrail(db, { entityType: "User", entityId: userId, action: "status_change", changes, performedBy: userId }).catch((err) => logger.error("Failed to audit an SSO event", { userId, err }));
}

/** The company's enabled single-sign-on connection, if it has one. */
export async function findConnection(): Promise<SsoConnection | null> {
  const [conn] = await db.select().from(ssoConnections);
  return conn && conn.enabled ? conn : null;
}

/**
 * Turns a validated provider response into a local user, or refuses. The
 * checks, in order: the provider's ID token is valid (done by openid-client);
 * it carries an email that the provider says is verified; that email is on a
 * domain the tenant proved it owns; then the account is found by the stable
 * provider subject, else by email, else created if auto-provisioning is on.
 * Auto-provisioned users never get an admin role.
 */
export async function handleCallback(callbackUrl: URL, flow: SsoFlowState): Promise<{ session: Awaited<ReturnType<typeof startSessionForSsoUser>>; provisioned: boolean }> {
  const [conn] = await db.select().from(ssoConnections).where(eq(ssoConnections.id, flow.cid));
  if (!conn || !conn.enabled) throw new SsoDenied("not_configured");

  let claims;
  try {
    claims = await completeAuthorization(conn, callbackUrl, flow);
  } catch (err) {
    logger.warn("SSO callback failed provider validation", { err: String(err) });
    throw new SsoDenied("provider_error");
  }

  const email = claims.email;
  if (!email) throw new SsoDenied("no_email");
  if (conn.requireVerifiedEmail && !claims.emailVerified) throw new SsoDenied("email_not_verified", { email });

  const domain = email.split("@")[1] ?? "";
  const [verified] = await db.select().from(ssoDomains).where(and(eq(ssoDomains.domain, domain)));
  if (!verified?.verifiedAt) throw new SsoDenied("domain_not_allowed", { email });

  // 1. Already linked to this provider identity.
  const [identity] = await db.select().from(userIdentities).where(and(eq(userIdentities.connectionId, conn.id), eq(userIdentities.subject, claims.sub)));
  let userId: number | null = identity?.userId ?? null;
  let provisioned = false;

  if (userId === null) {
    // 2. An existing account with this email.
    const [existing] = await db.select().from(users).where(sql`lower(${users.email}) = lower(${email})`);
    if (existing) {
      userId = existing.id;
    } else {
      // 3. Nothing yet: create it, but only when the company opted in, and never as an admin.
      if (!conn.autoProvision || !conn.defaultRoleId) throw new SsoDenied("no_account", { email });
      const [role] = await db.select().from(roles).where(eq(roles.id, conn.defaultRoleId));
      if (!role || SSO_FORBIDDEN_ROLES.has(role.name)) throw new SsoDenied("no_account", { email });
      const [created] = await db
        .insert(users)
        .values({ email, name: claims.name, roleId: role.id, passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 10), passwordChangedAt: new Date() })
        .returning();
      userId = created!.id;
      provisioned = true;
    }
    await db.insert(userIdentities).values({ userId, connectionId: conn.id, subject: claims.sub, email, lastLoginAt: new Date() });
    await audit(userId, { action: provisioned ? "sso_account_provisioned" : "sso_identity_linked", provider: conn.displayName, email });
  } else {
    await db.update(userIdentities).set({ lastLoginAt: new Date(), email }).where(eq(userIdentities.id, identity!.id));
  }

  const [target] = await db.select({ isActive: users.isActive, }).from(users).where(eq(users.id, userId));
  if (!target || !target.isActive) throw new SsoDenied("account_disabled", { email });

  await audit(userId, { action: "sso_login", provider: conn.displayName });
  return { session: await startSessionForSsoUser(userId), provisioned };
}

/** Records a refused SSO attempt against the company's audit trail (there is no user to attribute it to, so it hangs off the company). */
export async function auditDenied(denied: SsoDenied): Promise<void> {
  await recordAuditTrail(db, { entityType: "Company", entityId: 1, action: "status_change", changes: { action: "sso_login_denied", reason: denied.reason, ...denied.detail } }).catch((err) => logger.error("Failed to audit a refused SSO attempt", { err }));
}
