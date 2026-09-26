import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "./index.js";
import { company } from "../drizzle/schema/company.js";
import { roles } from "../drizzle/schema/roles.js";
import { users } from "../drizzle/schema/users.js";
import { formTemplates } from "../drizzle/schema/forms.js";
import { departmentPermissions } from "../drizzle/schema/permissions.js";
import { navHiddenItems } from "../drizzle/schema/navPreferences.js";
import { FORM_TYPES } from "../modules/forms/forms.validation.js";
import { INITIAL_DEFAULT_PERMISSIONS } from "./defaultPermissions.js";
import { defaultHiddenNavScopes } from "./defaultNavPreferences.js";
import { sendEmail } from "../modules/notifications/notification.service.js";
import { renderTemplate } from "../modules/notifications/templates.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import type { AccessLevel, Department, ResourceKey } from "../middleware/departmentAccess.js";

/** The built-in system roles every installation has. */
const SYSTEM_ROLES = [
  { name: "admin", description: "Administrator — full access" },
  { name: "quality_manager", description: "Manages NCR/CAPA/Audits/Suppliers" },
  { name: "auditor", description: "Conducts audits and reviews findings" },
  { name: "operator", description: "Shop-floor / production user" },
  { name: "supplier", description: "External supplier portal access" },
  { name: "customer", description: "External customer portal access" },
] as const;

export async function ensureSystemRoles(): Promise<void> {
  for (const role of SYSTEM_ROLES) {
    await db.insert(roles).values(role).onConflictDoNothing({ target: roles.name });
  }
}

interface ProvisionInput {
  name: string;
  adminEmail: string;
  adminName?: string;
  /** Given, it becomes the administrator's password; otherwise a random temporary one is generated and returned. */
  adminPassword?: string;
  /** Send the welcome email with the temporary password (default true when no password was given). */
  sendWelcomeEmail?: boolean;
}

/**
 * Sets up this installation's one company: the company record, its administrator, default department permissions,
 * default navigation, storage folders and default form templates. Refuses to run twice: there is only ever one company.
 */
export async function provisionCompany(input: ProvisionInput) {
  const [existing] = await db.select({ id: company.id }).from(company);
  if (existing) throw new Error("This installation already has its company. There is only one.");

  await ensureSystemRoles();

  const [created] = await db
    .insert(company)
    .values({ name: input.name, branding: {}, onboardingProgress: { dismissed: false, completedItems: [] } })
    .returning();
  if (!created) throw new Error("Failed to create the company");

  const [adminRole] = await db.select().from(roles).where(eq(roles.name, "admin"));
  const password = input.adminPassword ?? randomBytes(9).toString("base64url");
  const [adminUser] = await db
    .insert(users)
    .values({ email: input.adminEmail, passwordHash: await bcrypt.hash(password, 10), name: input.adminName ?? "Administrator", roleId: adminRole?.id ?? null })
    .returning();

  const permissionRows: { departmentName: Department; moduleName: ResourceKey; accessLevel: AccessLevel }[] = [];
  for (const moduleName of Object.keys(INITIAL_DEFAULT_PERMISSIONS) as ResourceKey[]) {
    const perDept = INITIAL_DEFAULT_PERMISSIONS[moduleName];
    for (const departmentName of Object.keys(perDept) as Department[]) {
      const accessLevel = perDept[departmentName];
      if (!accessLevel || accessLevel === "none") continue;
      permissionRows.push({ departmentName, moduleName, accessLevel });
    }
  }
  if (permissionRows.length > 0) await db.insert(departmentPermissions).values(permissionRows).onConflictDoNothing();

  await db.insert(navHiddenItems).values(defaultHiddenNavScopes().map((scope) => ({ scope }))).onConflictDoNothing();

  if (env.STORAGE_DRIVER === "local") {
    for (const dir of ["forms", "documents", "digital-twin", "exports", "attachments", "warranty", "supplier-portal"]) {
      await mkdir(`${env.STORAGE_LOCAL_PATH}/${dir}`, { recursive: true }).catch((err) => logger.warn(`Could not create storage folder ${dir}`, err));
    }
  }

  await db.insert(formTemplates).values(FORM_TYPES.map((formType) => ({ formType, pdfPath: `/templates/defaults/${formType}.pdf`, fieldMap: {}, isDefault: "true" })));

  let emailStatus: string | null = null;
  if (input.sendWelcomeEmail ?? !input.adminPassword) {
    const welcome = renderTemplate("company_onboarding", {
      companyName: created.name,
      adminName: input.adminName ?? "there",
      adminEmail: input.adminEmail,
      loginUrl: `${env.FRONTEND_URL}/login`,
      temporaryPassword: password,
    });
    emailStatus = await sendEmail({ to: input.adminEmail, subject: welcome.subject, body: welcome.body });
    logger.info(`Welcome email for "${created.name}": ${emailStatus}`, { to: input.adminEmail });
  }

  return { company: created, adminUser, temporaryPassword: input.adminPassword ? null : password, emailStatus };
}
