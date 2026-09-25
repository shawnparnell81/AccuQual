import "dotenv/config";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, pool } from "./index.js";
import { roles } from "../drizzle/schema/roles.js";
import { users } from "../drizzle/schema/users.js";
import { company } from "../drizzle/schema/company.js";
import { formTemplates } from "../drizzle/schema/forms.js";
import { FORM_TYPES } from "../modules/forms/forms.validation.js";
import { logger } from "../utils/logger.js";

/**
 * Seeds baseline RBAC roles, a platform admin (tenantId null — manages
 * tenants, see modules/platform), and one demo tenant + its tenant admin.
 * Safe to re-run.
 */
async function main() {
  logger.info("Seeding AccuQual development data...");

  const defaultRoles = [
    { name: "platform_admin", description: "AccuQual staff — manages tenants, not scoped to one" },
    { name: "admin", description: "Tenant admin — full access within their tenant" },
    { name: "quality_manager", description: "Manages NCR/CAPA/Audits/Suppliers" },
    { name: "auditor", description: "Conducts audits and reviews findings" },
    { name: "operator", description: "Shop-floor / production user" },
    { name: "supplier", description: "External supplier portal access" },
    { name: "customer", description: "External customer portal access" },
  ] as const;

  for (const role of defaultRoles) {
    await db.insert(roles).values(role).onConflictDoNothing({ target: roles.name });
  }

  const [platformAdminRole] = await db.select().from(roles).where(eq(roles.name, "platform_admin"));
  const [adminRole] = await db.select().from(roles).where(eq(roles.name, "admin"));

  const passwordHash = await bcrypt.hash("ChangeMe123!", 10);

  await db
    .insert(users)
    .values({
      email: "platform-admin@accuqual.local",
      passwordHash,
      name: "AccuQual Platform Admin",
      roleId: platformAdminRole?.id ?? null,
    })
    .onConflictDoNothing({ target: users.email });

  const [demoTenant] = await db
    .insert(company)
    .values({ name: "Demo Manufacturing Co.", code: "demo" })
    .onConflictDoNothing({ target: company.code })
    .returning();

  const tenant = demoTenant ?? (await db.select().from(company).where(eq(company.code, "demo")))[0];
  if (!tenant) throw new Error("Failed to seed demo tenant");

  await db
    .insert(users)
    .values({
      email: "admin@accuqual.local",
      passwordHash,
      name: "Demo Tenant Admin",
      roleId: adminRole?.id ?? null,
    })
    .onConflictDoNothing({ target: users.email });

  const existingTemplates = await db.select().from(formTemplates);
  if (existingTemplates.length === 0) {
    for (const formType of FORM_TYPES) {
      await db.insert(formTemplates).values({
        formType,
        pdfPath: `/templates/defaults/${formType}.pdf`,
        fieldMap: {},
        isDefault: "true",
      });
    }
  }

  logger.info("Seed complete.");
  logger.info("Platform admin: platform-admin@accuqual.local / ChangeMe123!");
  logger.info(`Demo tenant "${tenant.code}" admin: admin@accuqual.local / ChangeMe123! (tenantCode: "demo" to register more users)`);
  await pool.end();
}

main().catch((err) => {
  logger.error("Seed failed", err);
  process.exit(1);
});
