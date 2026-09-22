import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { eq, and, gte } from "drizzle-orm";
import { db } from "../../db/index.js";
import { tenants } from "../../drizzle/schema/tenants.js";
import { aiSuggestions } from "../../drizzle/schema/ai.js";
import { users } from "../../drizzle/schema/users.js";
import { roles } from "../../drizzle/schema/roles.js";
import { formTemplates } from "../../drizzle/schema/forms.js";
import { departmentPermissions } from "../../drizzle/schema/permissions.js";
import { navHiddenItems } from "../../drizzle/schema/navPreferences.js";
import { AppError } from "../../utils/appError.js";
import { logger } from "../../utils/logger.js";
import { env } from "../../config/env.js";
import { INITIAL_DEFAULT_PERMISSIONS } from "../../db/defaultPermissions.js";
import { defaultHiddenNavScopes } from "../../db/defaultNavPreferences.js";
import { isObviousTestName } from "../../utils/testDataGuard.js";
import { sendEmail } from "../notifications/notification.service.js";
import { renderTemplate } from "../notifications/templates.js";
import type { AccessLevel, Department, ResourceKey } from "../../middleware/departmentAccess.js";

/** Every QMS form type that gets a default fillable template on tenant creation. */
const DEFAULT_FORM_TYPES = [
  "ncr",
  "capa",
  "eight_d",
  "five_why",
  "audit_checklist",
  "audit_plan",
  "discrepancy_inspection",
  "supplier",
  "training",
  "change",
  "calibration",
  "complaint",
  "fmea",
  "appearance_approval",
  "apqp_summary",
  "control_plan",
  "dimensional_report",
  "lpa",
  "process_flow_diagram",
  "pcn",
  "production_log",
  "daily_production_log",
  "approved_vendor_list",
  "competency_matrix",
  "document_control_index",
  "context_of_organization",
  "dvpr",
  "management_review",
  "maintenance_work_order",
  "production_output_log",
  "gage_rr",
  "pareto_chart",
  "management_review_minutes",
  "staff_meeting_minutes",
  "final_inspection_release_checklist",
  // Both were missing from this list despite being real, registered form
  // types (see layouts/index.ts) with live "Open Form" buttons (Inventory
  // Item Record, Customer Requirements) — every tenant 404'd on Preview/
  // Export PDF for these two, forever. forms.service.ts's loadTemplate now
  // self-heals this class of gap generally, but keeping this seed list
  // accurate still means a brand-new tenant never needs the self-heal path.
  "inventory_item",
  "customer_requirements",
] as const;

interface CreateTenantInput {
  name: string;
  code: string;
  adminEmail: string;
  adminName?: string;
  branding?: Record<string, unknown>;
}

/**
 * Implements the Tenant Onboarding Flow Spec's creation steps 1-9. Platform-
 * admin only, and intentionally cross-tenant — uses the plain `db` singleton,
 * not a request-scoped `req.db` (there is no single tenant to scope to yet).
 */
export async function createTenant(input: CreateTenantInput) {
  if (env.NODE_ENV === "production" && (isObviousTestName(input.code) || isObviousTestName(input.name))) {
    throw AppError.badRequest(
      `Refusing to provision "${input.name}" (${input.code}) in production — its name/code matches the pattern automated tests use ` +
        "(e.g. \"...-test-<timestamp>\" or \"... Test Tenant ...\"). If this is a real company, rename it to avoid that pattern."
    );
  }

  const existingCode = await db.select().from(tenants).where(eq(tenants.code, input.code));
  if (existingCode.length > 0) throw AppError.badRequest("Tenant code already in use");

  // 1. Create tenant record — onboardingProgress starts fresh/incomplete (see
  //    db/defaultOnboardingChecklist.ts); an EXISTING tenant instead gets marked
  //    all-complete/dismissed once, by db/backfillOnboardingChecklist.ts.
  const [tenant] = await db
    .insert(tenants)
    .values({ name: input.name, code: input.code, branding: input.branding ?? {}, onboardingProgress: { dismissed: false, completedItems: [] } })
    .returning();
  if (!tenant) throw new AppError("Failed to create tenant", 500);

  // 2. Provision tenant admin user (role "admin" == this tenant's tenant_admin; MFA is a TODO, see README)
  const [adminRole] = await db.select().from(roles).where(eq(roles.name, "admin"));
  const temporaryPassword = randomBytes(9).toString("base64url");
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);
  const [adminUser] = await db
    .insert(users)
    .values({
      tenantId: tenant.id,
      email: input.adminEmail,
      passwordHash,
      name: input.adminName ?? "Tenant Admin",
      roleId: adminRole?.id ?? null,
    })
    .returning();

  // 3. Initialize tenant configuration — branding is on the tenant row
  //    already; the global system roles table (admin/quality_manager/etc)
  //    needs no per-tenant copy. The self-service Roles & Permissions
  //    module DOES need one, though: seed this tenant's department_permissions
  //    with the same defaults db/backfillDepartmentPermissions.ts gives every
  //    existing tenant, so a brand-new tenant starts with sane, real rows on
  //    file rather than an all-"none" empty slate (getUserAccessLevel has no
  //    hardcoded fallback to lean on anymore — see departmentAccess.ts).
  const defaultPermissionRows: { tenantId: number; departmentName: Department; moduleName: ResourceKey; accessLevel: AccessLevel }[] = [];
  for (const moduleName of Object.keys(INITIAL_DEFAULT_PERMISSIONS) as ResourceKey[]) {
    const perDept = INITIAL_DEFAULT_PERMISSIONS[moduleName];
    for (const departmentName of Object.keys(perDept) as Department[]) {
      const accessLevel = perDept[departmentName];
      if (!accessLevel || accessLevel === "none") continue;
      defaultPermissionRows.push({ tenantId: tenant.id, departmentName, moduleName, accessLevel });
    }
  }
  if (defaultPermissionRows.length > 0) {
    await db.insert(departmentPermissions).values(defaultPermissionRows).onConflictDoNothing();
  }

  // 3b. Seed default-hidden nav preferences (Phase 1 System-menu cleanup —
  //     see db/defaultNavPreferences.ts) — same seed-at-creation pattern as
  //     department_permissions above, so a brand-new tenant starts with the
  //     "advanced" System items already hidden instead of needing a tenant
  //     admin to hide them by hand.
  await db.insert(navHiddenItems).values(defaultHiddenNavScopes().map((scope) => ({ tenantId: tenant.id, scope }))).onConflictDoNothing();

  // 4. Provision tenant storage (local filesystem when STORAGE_DRIVER=local; a real
  //    deployment would provision the equivalent Azure Blob prefixes instead).
  if (env.STORAGE_DRIVER === "local") {
    for (const dir of ["forms", "documents", "digital-twin", "exports", "attachments", "warranty", "supplier-portal"]) {
      await mkdir(`${env.STORAGE_LOCAL_PATH}/tenants/${tenant.id}/${dir}`, { recursive: true }).catch((err) =>
        logger.warn(`Could not provision storage dir for tenant ${tenant.id}`, err)
      );
    }
  }

  // 5. Provision tenant PDF templates — defaults point at the shared AccuQual
  //    template set until the tenant uploads its own (see forms.service.ts).
  await db.insert(formTemplates).values(
    DEFAULT_FORM_TYPES.map((formType) => ({
      tenantId: tenant.id,
      formType,
      pdfPath: `/templates/defaults/${formType}.pdf`,
      fieldMap: {},
      isDefault: "true",
    }))
  );

  // 6. Provision tenant workflows — TODO: no default workflow_definitions are
  //    seeded yet; tenants start with an empty workflow list (see README).

  // 7. Provision tenant AI context — embeddings/prompts are already scoped by
  //    tenantId at write-time (see modules/ai), so no separate namespace record
  //    is needed; there is nothing else to create here yet.

  // 8. Provision tenant digital twin — model/simulation/IoT-device registries
  //    are just empty until the tenant creates its first model; nothing to insert.

  // 9. Send onboarding email. Phase 1 fix: this used to be its own
  //    disconnected `logger.info("[stub email]...")` call that never touched
  //    the real email service — auth.service.ts's password reset already
  //    called the real sendEmail()/SmtpTransport, but this path never did,
  //    so onboarding stayed "logged, not sent" even after real SMTP
  //    delivery was wired up for everything else. sendEmail() is the right
  //    fit here (not notify()/notifyDepartment(), which log to a tenant-
  //    scoped notification_log row this cross-tenant, pre-tenant-context
  //    createTenant() has no natural transaction to attach one to) — it's
  //    the exact "one-off, single-recipient... future account-level emails"
  //    case its own doc comment already anticipated.
  const onboardingEmail = renderTemplate("tenant_onboarding", {
    tenantName: tenant.name,
    adminName: input.adminName ?? "there",
    adminEmail: input.adminEmail,
    loginUrl: `${env.FRONTEND_URL}/login`,
    temporaryPassword,
  });
  const emailStatus = await sendEmail({ to: input.adminEmail, subject: onboardingEmail.subject, body: onboardingEmail.body });
  logger.info(`Onboarding email for tenant "${tenant.name}" (${tenant.code}): ${emailStatus}`, { to: input.adminEmail });

  return { tenant, adminUser: adminUser ? sanitizeUser(adminUser) : null, temporaryPassword, emailStatus };
}

export async function listTenants() {
  return db.select().from(tenants);
}

/**
 * Phase 4 AI Enablement — the Platform Admin AI configuration panel's one
 * data source: every tenant's AI status, computed live rather than stored,
 * plus real spend and recent error counts. A tenant's own provider/key
 * choice (Settings → Tenant AI Config) stays that tenant's own business —
 * this never exposes the key itself, only whether one is configured — but
 * platform staff need a cross-tenant view to spot "this tenant has been
 * failing every AI call for a week" without opening each tenant one by one.
 */
export async function getAiOverview() {
  const platformHasKey = Boolean(env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY);
  const allTenants = await db.select().from(tenants);

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - 30);

  const rows = await Promise.all(
    allTenants.map(async (tenant) => {
      const tenantHasKey = Boolean(tenant.aiConfig?.apiKeyEncrypted);
      const enabled = platformHasKey || tenantHasKey;

      const recent = await db
        .select({ status: aiSuggestions.status })
        .from(aiSuggestions)
        .where(and(eq(aiSuggestions.tenantId, tenant.id), gte(aiSuggestions.createdAt, sinceDate)));
      const errorCount = recent.filter((r) => r.status === "error" || r.status === "malformed").length;
      const stubCount = recent.filter((r) => r.status === "stub").length;
      const okCount = recent.filter((r) => r.status === "ok").length;

      // "degraded" beats "disabled" — a tenant with a key that's mostly
      // failing is a worse, more urgent state than one that was never
      // configured at all, so this order matters.
      const mode: "disabled" | "degraded" | "live" | "stub" = !enabled
        ? "disabled"
        : errorCount > 0 && errorCount >= okCount
          ? "degraded"
          : okCount > 0
            ? "live"
            : "stub";

      return {
        tenantId: tenant.id,
        tenantName: tenant.name,
        tenantCode: tenant.code,
        enabled,
        usesOwnKey: tenantHasKey,
        mode,
        last30Days: { ok: okCount, stub: stubCount, error: errorCount },
        totalTokens: tenant.aiUsageTokens,
        totalCost: tenant.aiUsageCost,
        monthlyLimit: tenant.aiMonthlyLimit,
        limitEnforced: tenant.aiLimitEnforced,
      };
    })
  );

  return { platformHasKey, platformProvider: env.LLM_PROVIDER, platformModel: env.LLM_MODEL, tenants: rows };
}

export async function updateTenant(id: number, patch: Partial<typeof tenants.$inferInsert>) {
  const [updated] = await db.update(tenants).set(patch).where(eq(tenants.id, id)).returning();
  if (!updated) throw AppError.notFound("Tenant");
  return updated;
}

/** Tenant Deletion Flow (soft delete) — spec section 8, steps 1-2 (users) + 5-6 (retain data). */
export async function deleteTenant(id: number) {
  const [tenant] = await db.update(tenants).set({ status: "inactive", isDeleted: true }).where(eq(tenants.id, id)).returning();
  if (!tenant) throw AppError.notFound("Tenant");

  await db.update(users).set({ isActive: false }).where(eq(users.tenantId, id));
  // Workflows/AI pipelines have no per-row "enabled" flag to flip yet (TODO);
  // in practice they become unreachable anyway once every user is deactivated
  // and the tenant's JWTs can no longer be issued (login checks tenant.status).

  return tenant;
}

function sanitizeUser<T extends { passwordHash?: string }>(user: T) {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}
