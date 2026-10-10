import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { db as appDb } from "../../db/index.js";
import { optionalRows, sqlIdent } from "../sites/optionalSql.js";

/**
 * Profile columns live in migration 0123. They are intentionally absent from
 * the Drizzle `users` table: a `select()` of that table lists every column
 * it knows, and login would fail if the code shipped before the migration.
 * These helpers use a missing-column guard instead.
 */

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contractor", "temporary"] as const;
export const SHIFTS = ["day", "evening", "night", "rotating"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export type ShiftName = (typeof SHIFTS)[number];

export interface OnboardingDocument {
  id: number;
  title: string;
}

export interface OnboardingCourse {
  id: number;
  title: string;
}

export interface OnboardingChecklist {
  documents: OnboardingDocument[];
  courses: OnboardingCourse[];
  trainingCourseIds: number[];
}

export interface UserProfile {
  preferredName: string | null;
  jobTitle: string | null;
  phone: string | null;
  employeeId: string | null;
  hireDate: string | null;
  employmentType: string | null;
  shift: string | null;
  siteLocation: string | null;
  bio: string | null;
  avatarAttachmentId: number | null;
  requireMfa: boolean;
  onboardingChecklist: OnboardingChecklist;
}

export interface ProfilePatch {
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
  onboardingChecklist?: OnboardingChecklist;
}

const EMPTY_PROFILE: UserProfile = {
  preferredName: null,
  jobTitle: null,
  phone: null,
  employeeId: null,
  hireDate: null,
  employmentType: null,
  shift: null,
  siteLocation: null,
  bio: null,
  avatarAttachmentId: null,
  requireMfa: false,
  onboardingChecklist: { documents: [], courses: [], trainingCourseIds: [] },
};

const COLUMN_BY_FIELD: Record<keyof ProfilePatch, string> = {
  preferredName: "preferred_name",
  jobTitle: "job_title",
  phone: "phone",
  employeeId: "employee_id",
  hireDate: "hire_date",
  employmentType: "employment_type",
  shift: "shift",
  siteLocation: "site_location",
  bio: "bio",
  avatarAttachmentId: "avatar_attachment_id",
  requireMfa: "require_mfa",
  onboardingChecklist: "onboarding_checklist",
};

function pgCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  if ("code" in err && typeof (err as { code?: unknown }).code === "string") return (err as { code: string }).code;
  if ("cause" in err) return pgCode((err as { cause?: unknown }).cause);
  return null;
}

function missingColumn(err: unknown): boolean {
  const code = pgCode(err);
  return code === "42703" || code === "42P01";
}

interface ProfileRow {
  preferred_name: string | null;
  job_title: string | null;
  phone: string | null;
  employee_id: string | null;
  hire_date: string | Date | null;
  employment_type: string | null;
  shift: string | null;
  site_location: string | null;
  bio: string | null;
  avatar_attachment_id: number | null;
  require_mfa: boolean | null;
  onboarding_checklist: OnboardingChecklist | null;
}

function asChecklist(value: OnboardingChecklist | null | undefined): OnboardingChecklist {
  const documents = Array.isArray(value?.documents) ? value.documents.filter((item) => item && typeof item.id === "number" && typeof item.title === "string") : [];
  const courses = Array.isArray(value?.courses) ? value.courses.filter((item) => item && typeof item.id === "number" && typeof item.title === "string") : [];
  const trainingCourseIds = Array.isArray(value?.trainingCourseIds) ? value.trainingCourseIds.filter((id) => typeof id === "number") : courses.map((course) => course.id);
  return { documents, courses, trainingCourseIds };
}

function fromRow(row: ProfileRow): UserProfile {
  const hire = row.hire_date instanceof Date ? row.hire_date.toISOString().slice(0, 10) : row.hire_date;
  return {
    preferredName: row.preferred_name,
    jobTitle: row.job_title,
    phone: row.phone,
    employeeId: row.employee_id,
    hireDate: hire ? String(hire).slice(0, 10) : null,
    employmentType: row.employment_type,
    shift: row.shift,
    siteLocation: row.site_location,
    bio: row.bio,
    avatarAttachmentId: row.avatar_attachment_id,
    requireMfa: row.require_mfa === true,
    onboardingChecklist: asChecklist(row.onboarding_checklist),
  };
}

const PROFILE_SELECT = sql`SELECT preferred_name, job_title, phone, employee_id, hire_date::text AS hire_date, employment_type, shift, site_location, bio, avatar_attachment_id, require_mfa, onboarding_checklist FROM users`;

/** Null when migration 0123 has not run. An empty profile when the person has no details yet. */
export async function readUserProfile(db: Db, userId: number): Promise<UserProfile | null> {
  const rows = (await optionalRows<Record<string, unknown>>(db, sql`${PROFILE_SELECT} WHERE id = ${userId}`)) as ProfileRow[] | null;
  if (rows == null) return null;
  const row = rows[0];
  return row ? fromRow(row) : { ...EMPTY_PROFILE, onboardingChecklist: { documents: [], courses: [], trainingCourseIds: [] } };
}

export async function readUserProfiles(db: Db, userIds: number[]): Promise<Map<number, UserProfile> | null> {
  if (userIds.length === 0) return new Map();
  const rows = (await optionalRows<Record<string, unknown>>(db, sql`SELECT id, preferred_name, job_title, phone, employee_id, hire_date::text AS hire_date, employment_type, shift, site_location, bio, avatar_attachment_id, require_mfa, onboarding_checklist FROM users WHERE id IN (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)})`)) as (ProfileRow & { id: number })[] | null;
  if (rows == null) return null;
  return new Map(rows.map((row) => [row.id, fromRow(row)]));
}

/** True when the row was written. False when the columns are not there yet. */
export async function writeUserProfile(db: Db, userId: number, patch: ProfilePatch): Promise<boolean> {
  const assignments: SQL[] = [];
  for (const key of Object.keys(COLUMN_BY_FIELD) as (keyof ProfilePatch)[]) {
    if (patch[key] === undefined) continue;
    const column = sqlIdent(COLUMN_BY_FIELD[key]);
    const value = key === "onboardingChecklist" ? JSON.stringify(patch.onboardingChecklist ?? { documents: [], courses: [], trainingCourseIds: [] }) : patch[key];
    if (key === "onboardingChecklist") assignments.push(sql`${sql.raw(column)} = ${value}::jsonb`);
    else assignments.push(sql`${sql.raw(column)} = ${value}`);
  }
  if (assignments.length === 0) return true;
  const wrote = await optionalRows(db, sql`UPDATE users SET ${sql.join(assignments, sql`, `)} WHERE id = ${userId} RETURNING id`);
  return wrote != null;
}

/**
 * Sign-in runs outside a request transaction, so a missing column is caught
 * here instead of with a savepoint. False when the column is not there yet.
 */
export async function personallyRequiresMfa(userId: number): Promise<boolean> {
  try {
    const result = await appDb.execute(sql`SELECT require_mfa FROM users WHERE id = ${userId}`);
    const row = result.rows[0] as { require_mfa?: boolean } | undefined;
    return row?.require_mfa === true;
  } catch (err) {
    if (missingColumn(err)) return false;
    throw err;
  }
}

/** Portrait fields for a session. Nulls when migration 0123 has not run. */
export async function readPortrait(userId: number): Promise<{ preferredName: string | null; avatarUrl: string | null }> {
  try {
    const result = await appDb.execute(sql`SELECT preferred_name, avatar_attachment_id FROM users WHERE id = ${userId}`);
    const row = result.rows[0] as { preferred_name?: string | null; avatar_attachment_id?: number | null } | undefined;
    if (!row) return { preferredName: null, avatarUrl: null };
    return {
      preferredName: row.preferred_name ?? null,
      avatarUrl: row.avatar_attachment_id ? `/users/${userId}/avatar` : null,
    };
  } catch (err) {
    if (missingColumn(err)) return { preferredName: null, avatarUrl: null };
    throw err;
  }
}

export function avatarUrlFor(userId: number, attachmentId: number | null | undefined): string | null {
  return attachmentId ? `/users/${userId}/avatar` : null;
}

export interface AuditEdit {
  label: string;
  from: string;
  to: string;
}

export function showAuditValue(value: unknown): string {
  if (value == null || value === "") return "(blank)";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length > 0 ? value.map((item) => String(item)).join(", ") : "(none)";
  return String(value);
}

/** Old to new, one line per field that actually changed. Blank and null compare as the same. */
export function changedEdits(before: object, after: object, labels: Record<string, string>): AuditEdit[] {
  const previous = before as Record<string, unknown>;
  const next = after as Record<string, unknown>;
  const edits: AuditEdit[] = [];
  for (const [key, label] of Object.entries(labels)) {
    const from = showAuditValue(previous[key]);
    const to = showAuditValue(next[key]);
    if (from !== to) edits.push({ label, from, to });
  }
  return edits;
}

/** Phrases for permissions stored on a role. The key is the stored permission, never a role name. */
export const ROLE_PERMISSION_PHRASES: Record<string, string> = {
  import_data: "Can import data",
  restore_archived_documents: "Can restore a document from Obsolete / Archive",
  form_builder: "Can build forms",
  "folders.rename": "Can rename folders",
  "folders.delete": "Can delete folders",
  "plants.delete": "Can delete plants",
  login_history: "Can view login history",
  "sites.view_all": "Can view every site",
  "executive.dashboard": "Can open the executive dashboard",
};

export function describeStoredPermissions(keys: readonly string[]): string[] {
  return keys.map((key) => ROLE_PERMISSION_PHRASES[key] ?? `Has the stored permission "${key}"`);
}

export function describeModuleLevel(label: string, level: string): string | null {
  if (level === "edit") return `Can change ${label}.`;
  if (level === "read") return `Can view ${label}.`;
  return null;
}

export function emptyProfile(): UserProfile {
  return { ...EMPTY_PROFILE, onboardingChecklist: { documents: [], courses: [], trainingCourseIds: [] } };
}
