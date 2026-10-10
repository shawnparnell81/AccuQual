import type { Request, Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { users } from "../../drizzle/schema/users.js";
import { attachments } from "../../drizzle/schema/attachments.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { sendStoredFile } from "../../utils/storedFile.js";
import { isFullAccessRole } from "../roles/roleAccess.js";
import type { Db } from "../../lib/requestDb.js";
import {
  accessPreview,
  applyOnboarding,
  applySiteChoice,
  assertAvatar,
  listPermissionRoleNames,
  listSiteNames,
  onboardingCatalog,
  replacePermissionRoles,
} from "./userOnboarding.js";
import {
  avatarUrlFor,
  changedEdits,
  emptyProfile,
  readUserProfile,
  readUserProfiles,
  writeUserProfile,
  type ProfilePatch,
  type UserProfile,
} from "./userProfile.js";
import { omitUserSecrets } from "./publicUser.js";

const PROFILE_LABELS: Record<string, string> = {
  preferredName: "Preferred name",
  jobTitle: "Job title",
  phone: "Phone",
  employeeId: "Employee ID",
  hireDate: "Hire date",
  employmentType: "Employment type",
  shift: "Shift",
  siteLocation: "Location within site",
  bio: "Bio",
  requireMfa: "Require two-step sign-in",
  sites: "Sites",
  training: "Required training",
  documents: "Documents to acknowledge",
  permissionRoles: "Extra permission roles",
  name: "Name",
  email: "Email",
  department: "Department",
  manager: "Manager",
  role: "Role",
  isActive: "Active",
};

export interface TeamMemberInput {
  preferredName?: string | null;
  jobTitle?: string | null;
  phone?: string | null;
  employeeId?: string | null;
  hireDate?: string | null;
  employmentType?: string | null;
  shift?: string | null;
  siteLocation?: string | null;
  bio?: string | null;
  avatarAttachmentId?: number | null;
  requireMfa?: boolean;
  siteIds?: number[];
  allSites?: boolean;
  trainingCourseIds?: number[];
  documentIds?: number[];
  permissionRoleIds?: number[];
}

function profilePatch(input: TeamMemberInput, checklist?: UserProfile["onboardingChecklist"]): ProfilePatch {
  const patch: ProfilePatch = {};
  const keys = ["preferredName", "jobTitle", "phone", "employeeId", "hireDate", "employmentType", "shift", "siteLocation", "bio", "avatarAttachmentId", "requireMfa"] as const;
  for (const key of keys) {
    if (input[key] !== undefined) (patch as Record<string, unknown>)[key] = input[key];
  }
  if (checklist && (checklist.documents.length > 0 || checklist.trainingCourseIds.length > 0)) patch.onboardingChecklist = checklist;
  return patch;
}

export async function presentUser<T extends { id: number; managerId?: number | null }>(db: Db, row: T, profile: UserProfile | null) {
  const [siteRows, permissionRows] = await Promise.all([listSiteNames(db, row.id), listPermissionRoleNames(db, row.id)]);
  let managerName: string | null = null;
  if (typeof row.managerId === "number") {
    const [manager] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, row.managerId));
    managerName = manager?.name?.trim() || manager?.email || null;
  }
  const details = profile ?? emptyProfile();
  return {
    ...omitUserSecrets(row),
    preferredName: profile ? details.preferredName : null,
    jobTitle: profile ? details.jobTitle : null,
    phone: profile ? details.phone : null,
    employeeId: profile ? details.employeeId : null,
    hireDate: profile ? details.hireDate : null,
    employmentType: profile ? details.employmentType : null,
    shift: profile ? details.shift : null,
    siteLocation: profile ? details.siteLocation : null,
    bio: profile ? details.bio : null,
    requireMfa: profile ? details.requireMfa : false,
    onboardingChecklist: profile ? details.onboardingChecklist : { documents: [], courses: [], trainingCourseIds: [] },
    avatarAttachmentId: profile?.avatarAttachmentId ?? null,
    avatarUrl: avatarUrlFor(row.id, profile?.avatarAttachmentId),
    profileStored: profile != null,
    sites: siteRows,
    permissionRoles: permissionRows,
    managerName,
  };
}

/** Sites, training, documents, extra roles, and profile columns. Returns the audit edits for those pieces. */
export async function applyTeamMemberExtras(db: Db, actorId: number | undefined, userId: number, input: TeamMemberInput): Promise<{ edits: { label: string; from: string; to: string }[]; profile: UserProfile | null }> {
  await assertAvatar(db, input.avatarAttachmentId);
  const before = (await readUserProfile(db, userId)) ?? emptyProfile();
  const beforeSites = (await listSiteNames(db, userId)).map((site) => site.name);
  const beforeRoles = (await listPermissionRoleNames(db, userId)).map((role) => role.name);

  const siteNames = await applySiteChoice(db, userId, input);
  const checklist = await applyOnboarding(db, actorId, userId, input);
  const mergedCourses = [...before.onboardingChecklist.courses];
  for (const course of checklist.courses) {
    if (!mergedCourses.some((existing) => existing.id === course.id)) mergedCourses.push(course);
  }
  const mergedChecklist = {
    documents: input.documentIds !== undefined ? checklist.documents : before.onboardingChecklist.documents,
    courses: input.trainingCourseIds !== undefined ? mergedCourses : before.onboardingChecklist.courses,
    trainingCourseIds: mergedCourses.map((course) => course.id),
  };
  const patch = profilePatch(input, input.documentIds !== undefined || input.trainingCourseIds !== undefined ? mergedChecklist : undefined);
  if (input.requireMfa) {
    patch.requireMfa = true;
    await db.update(users).set({ mfaRequiredSince: new Date() }).where(and(eq(users.id, userId), isNull(users.mfaRequiredSince)));
  }
  const stored = await writeUserProfile(db, userId, patch);
  const roleNames = input.permissionRoleIds !== undefined ? await replacePermissionRoles(db, userId, input.permissionRoleIds) : beforeRoles;
  const after = stored ? ((await readUserProfile(db, userId)) ?? before) : before;
  const afterSites = input.allSites || input.siteIds !== undefined ? siteNames : beforeSites;

  const edits = changedEdits(
    {
      ...before,
      sites: beforeSites,
      training: before.onboardingChecklist.courses.map((course) => course.title),
      documents: before.onboardingChecklist.documents.map((doc) => doc.title),
      permissionRoles: beforeRoles,
    },
    {
      ...after,
      sites: afterSites,
      training: after.onboardingChecklist.courses.map((course) => course.title),
      documents: after.onboardingChecklist.documents.map((doc) => doc.title),
      permissionRoles: roleNames,
    },
    PROFILE_LABELS,
  );
  return { edits, profile: stored ? after : null };
}

export const onboardingCatalogHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await onboardingCatalog(req.db!));
});

export const accessPreviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const roleId = Number(req.query.roleId);
  if (!Number.isInteger(roleId) || roleId <= 0) throw AppError.badRequest("Choose a role.");
  const department = typeof req.query.department === "string" && req.query.department ? req.query.department : null;
  const permissionRoleIds = typeof req.query.permissionRoleIds === "string" && req.query.permissionRoleIds
    ? req.query.permissionRoleIds.split(",").map((part) => Number(part)).filter((id) => Number.isInteger(id) && id > 0)
    : [];
  res.json(await accessPreview(req.db!, { roleId, department, permissionRoleIds }));
});

export const getUserAvatar = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.roleName === "supplier") throw AppError.forbidden("Supplier logins can't open staff photos.");
  const id = Number(req.params.id);
  const profile = await readUserProfile(req.db!, id);
  const attachmentId = profile?.avatarAttachmentId;
  if (!attachmentId) throw AppError.notFound("Photo");
  const [file] = await req.db!.select().from(attachments).where(eq(attachments.id, attachmentId));
  if (!file) throw AppError.notFound("Photo");
  await sendStoredFile(res, file.filePath, file.fileName, file.mimeType, "preview");
});

export const updateMyProfile = asyncHandler(async (req: Request, res: Response) => {
  const id = req.user!.id;
  const before = (await readUserProfile(req.db!, id)) ?? emptyProfile();
  const input = req.body as TeamMemberInput;
  await assertAvatar(req.db!, input.avatarAttachmentId);
  const stored = await writeUserProfile(req.db!, id, profilePatch(input));
  if (!stored) throw new AppError("Profile details can't be saved until the database update runs.", 503);
  const after = (await readUserProfile(req.db!, id)) ?? before;
  const edits = changedEdits(before, after, PROFILE_LABELS);
  if (edits.length > 0) {
    await recordAuditTrail(req.db!, { entityType: "User", entityId: id, action: "update", changes: { edits }, performedBy: id });
  }
  const [row] = await req.db!.select().from(users).where(eq(users.id, id));
  res.json(await presentUser(req.db!, row!, after));
});

export async function attachListProfiles<T extends { id: number }>(db: Db, rows: T[]): Promise<(T & { preferredName: string | null; jobTitle: string | null; avatarUrl: string | null })[]> {
  const profiles = await readUserProfiles(db, rows.map((row) => row.id));
  return rows.map((row) => {
    const profile = profiles?.get(row.id);
    return {
      ...row,
      preferredName: profile?.preferredName ?? null,
      jobTitle: profile?.jobTitle ?? null,
      avatarUrl: avatarUrlFor(row.id, profile?.avatarAttachmentId),
    };
  });
}

export function canReadStaffProfile(roleName: string | null | undefined, requesterId: number | undefined, targetId: number): boolean {
  return isFullAccessRole(roleName) || requesterId === targetId;
}
