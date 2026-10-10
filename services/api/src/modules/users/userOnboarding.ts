import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { users } from "../../drizzle/schema/users.js";
import { roles } from "../../drizzle/schema/roles.js";
import { sites, userSites } from "../../drizzle/schema/sites.js";
import { documents } from "../../drizzle/schema/documents.js";
import { trainingCourses } from "../../drizzle/schema/training.js";
import { permissionRoles, permissionRoleModules, userPermissionRoles } from "../../drizzle/schema/permissions.js";
import { attachments } from "../../drizzle/schema/attachments.js";
import { AppError } from "../../utils/appError.js";
import { getDepartmentAccessLevel, MODULE_LABELS, VISIBLE_RESOURCE_KEYS, type Department } from "../../middleware/departmentAccess.js";
import { assignCourse } from "../training/training.service.js";
import { describeModuleLevel, describeStoredPermissions, type OnboardingChecklist, type OnboardingDocument } from "./userProfile.js";

export interface AccessPreview {
  roleName: string | null;
  /** Capabilities stored on the chosen role's permission list. */
  capabilities: string[];
  /** Module access stored for the chosen department. */
  departmentAccess: string[];
  /** Grants from the extra permission roles the admin picked. */
  extraRoles: { id: number; name: string; grants: string[] }[];
  /** Where an administrator changes these lists. */
  adjustPath: string;
}

export async function accessPreview(
  db: Db,
  input: { roleId: number; department: string | null; permissionRoleIds: number[] },
): Promise<AccessPreview> {
  const [role] = await db.select({ name: roles.name, permissions: roles.permissions }).from(roles).where(eq(roles.id, input.roleId));
  if (!role) throw AppError.badRequest("That role doesn't exist.");

  const department = input.department as Department | null;
  const departmentAccess: string[] = [];
  if (department) {
    for (const moduleName of VISIBLE_RESOURCE_KEYS) {
      const level = await getDepartmentAccessLevel(db, department, moduleName);
      const sentence = describeModuleLevel(MODULE_LABELS[moduleName], level);
      if (sentence) departmentAccess.push(sentence);
    }
  }

  const extraRoles: AccessPreview["extraRoles"] = [];
  if (input.permissionRoleIds.length > 0) {
    const roleRows = await db.select({ id: permissionRoles.id, roleName: permissionRoles.roleName }).from(permissionRoles).where(inArray(permissionRoles.id, input.permissionRoleIds));
    const grants = await db
      .select({ roleId: permissionRoleModules.roleId, moduleName: permissionRoleModules.moduleName, accessLevel: permissionRoleModules.accessLevel })
      .from(permissionRoleModules)
      .where(inArray(permissionRoleModules.roleId, input.permissionRoleIds));
    for (const extra of roleRows) {
      const lines = grants
        .filter((grant) => grant.roleId === extra.id)
        .map((grant) => describeModuleLevel(MODULE_LABELS[grant.moduleName as keyof typeof MODULE_LABELS] ?? grant.moduleName, grant.accessLevel))
        .filter((line): line is string => line != null);
      extraRoles.push({ id: extra.id, name: extra.roleName, grants: lines });
    }
  }

  return {
    roleName: role.name,
    capabilities: describeStoredPermissions(role.permissions ?? []),
    departmentAccess,
    extraRoles,
    adjustPath: "/admin/roles-permissions",
  };
}

export interface OnboardingCatalog {
  courses: { id: number; title: string; description: string | null }[];
  documents: { id: number; title: string; status: string }[];
}

export async function onboardingCatalog(db: Db): Promise<OnboardingCatalog> {
  const courses = await db
    .select({ id: trainingCourses.id, title: trainingCourses.title, description: trainingCourses.description })
    .from(trainingCourses)
    .where(eq(trainingCourses.active, true))
    .orderBy(asc(trainingCourses.title));
  const docs = await db
    .select({ id: documents.id, title: documents.title, status: documents.status })
    .from(documents)
    .where(and(eq(documents.isDeleted, false), inArray(documents.status, ["approved", "in_review"])))
    .orderBy(asc(documents.title))
    .limit(200);
  return { courses, documents: docs };
}

async function livingSiteIds(db: Db, only?: number[]): Promise<{ id: number; name: string }[]> {
  const rows = await db
    .select({ id: sites.id, name: sites.name })
    .from(sites)
    .where(and(isNull(sites.deletedAt), eq(sites.status, "active"), only && only.length > 0 ? inArray(sites.id, only) : undefined))
    .orderBy(asc(sites.name));
  return rows;
}

/** Replaces plant membership when the wizard chose sites. Leaves the default-plant trigger alone when sites were omitted. */
export async function applySiteChoice(db: Db, userId: number, input: { siteIds?: number[]; allSites?: boolean }): Promise<string[]> {
  if (!input.allSites && input.siteIds === undefined) return [];
  const requested = input.siteIds ?? [];
  if (!input.allSites && requested.length === 0) {
    await db.delete(userSites).where(eq(userSites.userId, userId));
    return [];
  }
  const chosen = input.allSites ? await livingSiteIds(db) : await livingSiteIds(db, requested);
  if (input.allSites && chosen.length === 0) throw AppError.badRequest("There isn't an active site to assign.");
  if (!input.allSites && (input.siteIds?.length ?? 0) > 0 && chosen.length !== input.siteIds!.length) {
    throw AppError.badRequest("One of those sites isn't an active plant.");
  }
  await db.delete(userSites).where(eq(userSites.userId, userId));
  if (chosen.length > 0) {
    await db.insert(userSites).values(chosen.map((site) => ({ userId, siteId: site.id })));
    await db.update(users).set({ currentSiteId: chosen[0]!.id }).where(eq(users.id, userId));
  }
  return chosen.map((site) => site.name);
}

export async function assertAvatar(db: Db, attachmentId: number | null | undefined): Promise<void> {
  if (attachmentId == null) return;
  const [file] = await db.select({ id: attachments.id, mimeType: attachments.mimeType }).from(attachments).where(eq(attachments.id, attachmentId));
  if (!file) throw AppError.badRequest("That photo isn't on file.");
  const mime = file.mimeType ?? "";
  if (!mime.startsWith("image/") || mime === "image/svg+xml") throw AppError.badRequest("The profile photo has to be a picture.");
}

export async function applyOnboarding(
  db: Db,
  actorId: number | undefined,
  userId: number,
  input: { trainingCourseIds?: number[]; documentIds?: number[] },
): Promise<OnboardingChecklist> {
  const trainingCourseIds = [...new Set(input.trainingCourseIds ?? [])];
  let courses: { id: number; title: string }[] = [];
  if (trainingCourseIds.length > 0) {
    const rows = await db.select({ id: trainingCourses.id, title: trainingCourses.title }).from(trainingCourses).where(inArray(trainingCourses.id, trainingCourseIds));
    if (rows.length !== trainingCourseIds.length) throw AppError.badRequest("One of those training records doesn't exist.");
    courses = rows.map((row) => ({ id: row.id, title: row.title }));
    for (const courseId of trainingCourseIds) {
      await assignCourse(db, courseId, [userId], { reason: "new team member" }, actorId);
    }
  }
  let documentsChosen: OnboardingDocument[] = [];
  const documentIds = [...new Set(input.documentIds ?? [])];
  if (documentIds.length > 0) {
    const rows = await db.select({ id: documents.id, title: documents.title }).from(documents).where(and(inArray(documents.id, documentIds), eq(documents.isDeleted, false)));
    if (rows.length !== documentIds.length) throw AppError.badRequest("One of those documents doesn't exist.");
    documentsChosen = rows.map((row) => ({ id: row.id, title: row.title }));
  }
  return { documents: documentsChosen, courses, trainingCourseIds };
}

export async function replacePermissionRoles(db: Db, userId: number, permissionRoleIds: number[] | undefined): Promise<string[]> {
  if (permissionRoleIds === undefined) return [];
  const unique = [...new Set(permissionRoleIds)];
  if (unique.length > 0) {
    const found = await db.select({ id: permissionRoles.id, roleName: permissionRoles.roleName }).from(permissionRoles).where(inArray(permissionRoles.id, unique));
    if (found.length !== unique.length) throw AppError.badRequest("One of those permission roles doesn't exist.");
    await db.delete(userPermissionRoles).where(eq(userPermissionRoles.userId, userId));
    await db.insert(userPermissionRoles).values(unique.map((roleId) => ({ userId, roleId })));
    return found.map((role) => role.roleName);
  }
  await db.delete(userPermissionRoles).where(eq(userPermissionRoles.userId, userId));
  return [];
}

export async function listSiteNames(db: Db, userId: number): Promise<{ id: number; name: string }[]> {
  return db
    .select({ id: sites.id, name: sites.name })
    .from(userSites)
    .innerJoin(sites, eq(sites.id, userSites.siteId))
    .where(eq(userSites.userId, userId))
    .orderBy(asc(sites.name));
}

export async function listPermissionRoleNames(db: Db, userId: number): Promise<{ id: number; name: string }[]> {
  const rows = await db
    .select({ id: permissionRoles.id, name: permissionRoles.roleName })
    .from(userPermissionRoles)
    .innerJoin(permissionRoles, eq(permissionRoles.id, userPermissionRoles.roleId))
    .where(eq(userPermissionRoles.userId, userId))
    .orderBy(asc(permissionRoles.roleName));
  return rows;
}
