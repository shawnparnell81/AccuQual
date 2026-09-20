import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users } from "../../drizzle/schema/users.js";
import { roles } from "../../drizzle/schema/roles.js";
import { tenants } from "../../drizzle/schema/tenants.js";
import { ssoConnections, ssoDomains, userIdentities, type SsoConnection } from "../../drizzle/schema/sso.js";
import { logger } from "../../utils/logger.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { startSessionForSsoUser } from "../auth/auth.service.js";
import { completeAuthorization, type SsoFlowState } from "./oidc.js";

/** Roles SSO may never hand out on its own: whoever controls (or spoofs) the provider must not be able to mint admins. */
export const SSO_FORBIDDEN_ROLES = new Set(["admin", "platform_admin"]);

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
  | "email_in_other_organization"
  | "no_account"
  | "account_disabled"
  | "not_configured";

export class SsoDenied extends Error {
  constructor(public readonly reason: SsoDenyReason, public readonly tenantId?: number, public readonly detail?: Record<string, unknown>) {
    super(reason);
  }
}

async function audit(tenantId: number, userId: number, changes: Record<string, unknown>) {
  await recordAuditTrail(db, { tenantId, entityType: "User", entityId: userId, action: "status_change", changes, performedBy: userId }).catch((err) => logger.error("Failed to audit an SSO event", { userId, err }));
}

export async function findConnectionByTenantCode(code: string): Promise<SsoConnection | null> {
  const [row] = await db
    .select({ conn: ssoConnections, status: tenants.status, isDeleted: tenants.isDeleted })
    .from(ssoConnections)
    .innerJoin(tenants, eq(tenants.id, ssoConnections.tenantId))
    .where(eq(tenants.code, code));
  if (!row || !row.conn.enabled || row.status !== "active" || row.isDeleted) return null;
  return row.conn;
}

/**
 * Turns a validated provider response into a local user, or refuses. The
 * checks, in order: the provider's ID token is valid (done by openid-client);
 * it carries an email that the provider says is verified; that email is on a
 * domain the tenant proved it owns; then the account is found by the stable
 * provider subject, else by email within THIS tenant only, else created if
 * auto-provisioning is on. An email that already belongs to another tenant is
 * never linked, and auto-provisioned users never get an admin role.
 */
export async function handleCallback(callbackUrl: URL, flow: SsoFlowState): Promise<{ session: Awaited<ReturnType<typeof startSessionForSsoUser>>; provisioned: boolean }> {
  const [conn] = await db.select().from(ssoConnections).where(eq(ssoConnections.id, flow.cid));
  if (!conn || !conn.enabled) throw new SsoDenied("not_configured");
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, conn.tenantId));
  if (!tenant || tenant.status !== "active" || tenant.isDeleted) throw new SsoDenied("not_configured", conn.tenantId);

  let claims;
  try {
    claims = await completeAuthorization(conn, callbackUrl, flow);
  } catch (err) {
    logger.warn("SSO callback failed provider validation", { tenantId: conn.tenantId, err: String(err) });
    throw new SsoDenied("provider_error", conn.tenantId);
  }

  const email = claims.email;
  if (!email) throw new SsoDenied("no_email", conn.tenantId);
  if (conn.requireVerifiedEmail && !claims.emailVerified) throw new SsoDenied("email_not_verified", conn.tenantId, { email });

  const domain = email.split("@")[1] ?? "";
  const [verified] = await db.select().from(ssoDomains).where(and(eq(ssoDomains.tenantId, conn.tenantId), eq(ssoDomains.domain, domain)));
  if (!verified?.verifiedAt) throw new SsoDenied("domain_not_allowed", conn.tenantId, { email });

  // 1. Already linked to this provider identity.
  const [identity] = await db.select().from(userIdentities).where(and(eq(userIdentities.connectionId, conn.id), eq(userIdentities.subject, claims.sub)));
  let userId: number | null = identity?.userId ?? null;
  let provisioned = false;

  if (userId === null) {
    // 2. An existing account with this email — only ever inside this tenant.
    const [existing] = await db.select().from(users).where(eq(users.email, email));
    if (existing) {
      if (existing.tenantId !== conn.tenantId) throw new SsoDenied("email_in_other_organization", conn.tenantId, { email });
      userId = existing.id;
    } else {
      // 3. Nothing yet: create it, but only when the tenant opted in, and never as an admin.
      if (!conn.autoProvision || !conn.defaultRoleId) throw new SsoDenied("no_account", conn.tenantId, { email });
      const [role] = await db.select().from(roles).where(eq(roles.id, conn.defaultRoleId));
      if (!role || SSO_FORBIDDEN_ROLES.has(role.name)) throw new SsoDenied("no_account", conn.tenantId, { email });
      const [created] = await db
        .insert(users)
        .values({ tenantId: conn.tenantId, email, name: claims.name, roleId: role.id, passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 10), passwordChangedAt: new Date() })
        .returning();
      userId = created!.id;
      provisioned = true;
    }
    await db.insert(userIdentities).values({ tenantId: conn.tenantId, userId, connectionId: conn.id, subject: claims.sub, email, lastLoginAt: new Date() });
    await audit(conn.tenantId, userId, { action: provisioned ? "sso_account_provisioned" : "sso_identity_linked", provider: conn.displayName, email });
  } else {
    await db.update(userIdentities).set({ lastLoginAt: new Date(), email }).where(eq(userIdentities.id, identity!.id));
  }

  const [target] = await db.select({ isActive: users.isActive, tenantId: users.tenantId }).from(users).where(eq(users.id, userId));
  if (!target || !target.isActive || target.tenantId !== conn.tenantId) throw new SsoDenied("account_disabled", conn.tenantId, { email });

  await audit(conn.tenantId, userId, { action: "sso_login", provider: conn.displayName });
  return { session: await startSessionForSsoUser(userId), provisioned };
}

/** Records a refused SSO attempt against the tenant's audit trail (there is no user to attribute it to, so it hangs off the tenant). */
export async function auditDenied(denied: SsoDenied): Promise<void> {
  if (!denied.tenantId) return;
  await recordAuditTrail(db, { tenantId: denied.tenantId, entityType: "Tenant", entityId: denied.tenantId, action: "status_change", changes: { action: "sso_login_denied", reason: denied.reason, ...denied.detail } }).catch((err) => logger.error("Failed to audit a refused SSO attempt", { err }));
}
