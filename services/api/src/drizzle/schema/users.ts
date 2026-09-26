import { pgTable, serial, text, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { roles } from "./roles.js";
import { suppliers } from "./supplier.js";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
    email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  roleId: integer("role_id").references(() => roles.id),
  // Which department dropdown's permissions (see middleware/departmentAccess.ts)
  // apply to this user: "quality" | "engineering" | "production" |
  // "customer_service" | "purchasing" | "material_management" | null.
  // Independent of roleId — role is job function (manager/operator/auditor),
  // department is which nav dropdown's RWX rules this user gets. Nullable:
  // admin bypass the department matrix entirely, and external
  // supplier/customer portal accounts aren't part of any internal department.
  department: text("department"),
  // Last plant this user was working in. Switching plants writes this; it is
  // not a JWT claim, so a switch does not require a new login. Null for
  // someone who isn't assigned anywhere.
  // Plain integer — a Drizzle FK back to sites.ts would cycle (sites already
  // references users). The migration adds the real foreign key.
  currentSiteId: integer("current_site_id"),
  // Which real supplier company this login belongs to — set ONLY for
  // roleName:"supplier" (Supplier Portal) accounts, the external-login
  // counterpart to `department` above for internal staff. Every
  // supplier-portal route scopes its queries to this id (never trusts a
  // supplierId the client sends), which is how "a supplier can only ever
  // see their own data" is actually enforced, not just hidden in the UI.
  // Null for every internal/admin account.
  supplierId: integer("supplier_id").references(() => suppliers.id),
  tokenVersion: integer("token_version").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  // Phase 7 — Supplier Portal health indicators ("last supplier login").
  // Stamped by auth.service.ts's login() on every successful login, any
  // role — not supplier-specific at the column level, but the only
  // consumer today is the Supplier Portal / internal Supplier health-
  // indicators view, which reads it only for roleName:"supplier" accounts.
  lastLoginAt: timestamp("last_login_at"),
  // Login lockout (auth.service.ts): wrong passwords counted inside a rolling
  // window, then a timed lock. Cleared by a good login, a password reset, or an admin unlock.
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  firstFailedLoginAt: timestamp("first_failed_login_at"),
  lockedUntil: timestamp("locked_until"),
  passwordChangedAt: timestamp("password_changed_at"),
  // Multi-factor authentication (TOTP). The secret is AES-256-GCM ciphertext
  // (company/crypto.ts) and is written on enrollment start but only counts once
  // mfaEnabled flips true after the user proves a first code.
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  mfaSecretEncrypted: text("mfa_secret_encrypted"),
  mfaEnrolledAt: timestamp("mfa_enrolled_at"),
  // Highest TOTP time-step already accepted — a code can never be replayed.
  mfaLastUsedStep: integer("mfa_last_used_step"),
  // When the user was first told their company policy requires MFA; the enrollment grace period counts from here.
  mfaRequiredSince: timestamp("mfa_required_since"),
  // This user's own theme overrides, layered on top of their company's theme
  // (companies.branding) — see the Theme System review. mode is "light" |
  // "dark" | "system"; unset means "follow the company/default theme" for
  // every field independently, not an all-or-nothing override.
  themePreferences: jsonb("theme_preferences").$type<{ mode?: "light" | "dark" | "system"; primaryColor?: string; accentColor?: string }>(),
  // The newest changelog version (see apps/web/src/data/changelog.ts) this user has opened the "what's new" panel at —
  // null means they've never opened it. Compared client-side against the changelog's own latest entry to decide whether
  // the header badge shows; nothing server-side needs to know what the entries actually say.
  lastSeenChangelogVersion: text("last_seen_changelog_version"),
  // Per-user saved list-view search filters, keyed by an opaque page id the caller chooses (e.g. "ncr-list") — one blob
  // holds every list page's saved views rather than a table-per-page, same reasoning themePreferences uses for a single
  // jsonb column instead of several scalar ones. Scoped to a free-text search string, not per-column sort/filter state:
  // ResourceListPage's Column<T>.accessor returns ReactNode, not a plain sortable value, so a generic sort control isn't
  // type-safe to build without touching every one of DataTable's ~21 existing callers — deliberately out of scope here.
  savedViews: jsonb("saved_views").$type<Record<string, { label: string; searchText: string }[]>>().default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
