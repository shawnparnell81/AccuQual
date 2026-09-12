import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { tenants } from "../../drizzle/schema/tenants.js";
import { users } from "../../drizzle/schema/users.js";
import { roles } from "../../drizzle/schema/roles.js";
import { formTemplates } from "../../drizzle/schema/forms.js";
import { AppError } from "../../utils/appError.js";
import { logger } from "../../utils/logger.js";
import { env } from "../../config/env.js";

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
  const existingCode = await db.select().from(tenants).where(eq(tenants.code, input.code));
  if (existingCode.length > 0) throw AppError.badRequest("Tenant code already in use");

  // 1. Create tenant record
  const [tenant] = await db
    .insert(tenants)
    .values({ name: input.name, code: input.code, branding: input.branding ?? {} })
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

  // 3. Initialize tenant configuration — branding is on the tenant row already;
  //    default roles/permissions are global (see roles table) and need no per-tenant copy.

  // 4. Provision tenant storage (local filesystem when STORAGE_DRIVER=local; a real
  //    deployment would provision the equivalent Azure Blob prefixes instead).
  if (env.STORAGE_DRIVER === "local") {
    for (const dir of ["forms", "documents", "digital-twin", "exports"]) {
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

  // 9. Send onboarding email — no email service is wired up yet, so this is
  //    logged rather than actually sent (see README TODOs).
  logger.info(`[stub email] Onboarding ${input.adminEmail} for tenant "${tenant.name}" (${tenant.code})`, {
    loginUrl: "/login",
    temporaryPassword,
  });

  return { tenant, adminUser: adminUser ? sanitizeUser(adminUser) : null, temporaryPassword };
}

export async function listTenants() {
  return db.select().from(tenants);
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
