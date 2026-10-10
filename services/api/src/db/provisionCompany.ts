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
import { ROLE_SEEDS } from "../modules/roles/roleHierarchy.js";
import { deletedRoleNames, systemRolesToInsert } from "../modules/roles/deletedSystemRoles.js";

/** The built-in system roles every installation has. A role an administrator removed is not created again. */
export async function ensureSystemRoles(): Promise<void> {
  const existing = await db.select({ name: roles.name }).from(roles);
  const [row] = await db.select({ profile: company.profile }).from(company).limit(1);
  const missing = systemRolesToInsert(ROLE_SEEDS, existing.map((role) => role.name), [...deletedRoleNames(row?.profile?.deletedSystemRoles)]);
  for (const role of missing) {
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
    .values({ email: input.adminEmail.trim().toLowerCase(), passwordHash: await bcrypt.hash(password, 10), name: input.adminName ?? "Administrator", roleId: adminRole?.id ?? null, mustChangePassword: !input.adminPassword })
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
