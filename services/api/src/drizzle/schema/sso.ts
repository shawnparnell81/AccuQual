import { pgTable, serial, integer, text, boolean, timestamp, unique } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { roles } from "./roles.js";

/**
 * A tenant's single-sign-on connection (OpenID Connect). One per tenant.
 * The client secret is AES-256-GCM ciphertext (tenant/crypto.ts), never returned by any GET.
 */
export const ssoConnections = pgTable("sso_connections", {
  id: serial("id").primaryKey(),
  displayName: text("display_name").notNull().default("Single sign-on"),
  issuer: text("issuer").notNull(),
  clientId: text("client_id").notNull(),
  clientSecretEncrypted: text("client_secret_encrypted").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  // Create an account on first SSO sign-in for a verified-domain email that has none. Off by default.
  autoProvision: boolean("auto_provision").notNull().default(false),
  // Role given to auto-provisioned users. Never an admin role — checked when saved and again when used.
  defaultRoleId: integer("default_role_id").references(() => roles.id),
  // Password sign-in is refused for everyone except admins (the break-glass path).
  enforceSso: boolean("enforce_sso").notNull().default(false),
  // Some providers (notably Microsoft Entra ID) do not send email_verified. Unchecking this trusts the provider's email claim as-is.
  requireVerifiedEmail: boolean("require_verified_email").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

/**
 * An email domain the tenant has proven it controls (DNS TXT record). SSO only
 * accepts identities whose email is on a verified domain, so a misconfigured or
 * hostile identity provider cannot vouch for an address the tenant does not own.
 */
export const ssoDomains = pgTable(
  "sso_domains",
  {
    id: serial("id").primaryKey(),
    domain: text("domain").notNull(),
    verificationToken: text("verification_token").notNull(),
    verifiedAt: timestamp("verified_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({ uniqueDomainPerTenant: unique("sso_domains_domain_uq").on(t.domain) }),
);

/** Links a local user to their identity at the provider (the stable `sub`, not the mutable email). */
export const userIdentities = pgTable(
  "user_identities",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id).notNull(),
    connectionId: integer("connection_id").references(() => ssoConnections.id, { onDelete: "cascade" }).notNull(),
    subject: text("subject").notNull(),
    email: text("email"),
    createdAt: timestamp("created_at").defaultNow(),
    lastLoginAt: timestamp("last_login_at"),
  },
  (t) => ({ uniqueSubject: unique("user_identities_connection_subject_uq").on(t.connectionId, t.subject) }),
);

export type SsoConnection = typeof ssoConnections.$inferSelect;
export type SsoDomain = typeof ssoDomains.$inferSelect;
