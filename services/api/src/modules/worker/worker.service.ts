import { and, eq, isNull, notInArray, or } from "drizzle-orm";
import type { TenantDb } from "../../lib/tenantScope.js";
import { users } from "../../drizzle/schema/users.js";
import { roles } from "../../drizzle/schema/roles.js";
import { workerProfiles, type EmploymentStatus } from "../../drizzle/schema/workerProfiles.js";
import { AppError } from "../../utils/appError.js";
import { getItemsForUser, type CalendarItem } from "../calendar/calendar.controller.js";

// Mirrors requirePermission.ts's own EXTERNAL_ROLES — a supplier/customer
// portal login is never a member of anyone's internal workforce roster.
// NULL role name (no roleId set) is left in rather than excluded — a NOT
// IN comparison against NULL is neither true nor false in SQL, so it
// would silently drop a roleless user instead of showing them.
const EXTERNAL_ROLE_NAMES: string[] = ["customer", "supplier"];
const internalOnly = or(isNull(roles.name), notInArray(roles.name, EXTERNAL_ROLE_NAMES));

export interface WorkerProfileView {
  userId: number;
  name: string | null;
  email: string;
  department: string | null;
  roleName: string | null;
  isActive: boolean;
  jobTitle: string | null;
  shift: string | null;
  hireDate: string | null;
  skills: string[];
  employmentStatus: EmploymentStatus;
  notes: string | null;
  updatedAt: string | null;
}

function toView(row: {
  userId: number;
  name: string | null;
  email: string;
  department: string | null;
  roleName: string | null;
  isActive: boolean;
  jobTitle: string | null;
  shift: string | null;
  hireDate: Date | null;
  skills: string[] | null;
  employmentStatus: string | null;
  notes: string | null;
  updatedAt: Date | null;
}): WorkerProfileView {
  return {
    userId: row.userId,
    name: row.name,
    email: row.email,
    department: row.department,
    roleName: row.roleName,
    isActive: row.isActive,
    jobTitle: row.jobTitle,
    shift: row.shift,
    hireDate: row.hireDate ? row.hireDate.toISOString() : null,
    skills: row.skills ?? [],
    employmentStatus: (row.employmentStatus as EmploymentStatus) ?? "active",
    notes: row.notes,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

/** The roster: every internal user of this tenant, with their profile fields left-joined in (a user who has never been given a profile still appears, with employmentStatus defaulting to "active"). */
export async function listWorkers(db: TenantDb, tenantId: number): Promise<WorkerProfileView[]> {
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      department: users.department,
      roleName: roles.name,
      isActive: users.isActive,
      jobTitle: workerProfiles.jobTitle,
      shift: workerProfiles.shift,
      hireDate: workerProfiles.hireDate,
      skills: workerProfiles.skills,
      employmentStatus: workerProfiles.employmentStatus,
      notes: workerProfiles.notes,
      updatedAt: workerProfiles.updatedAt,
    })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .leftJoin(workerProfiles, and(eq(workerProfiles.userId, users.id), eq(workerProfiles.tenantId, tenantId)))
    .where(and(eq(users.tenantId, tenantId), internalOnly));
  return rows.map(toView);
}

async function loadOne(db: TenantDb, tenantId: number, userId: number, restrictToInternal: boolean): Promise<WorkerProfileView> {
  const [row] = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      department: users.department,
      roleName: roles.name,
      isActive: users.isActive,
      jobTitle: workerProfiles.jobTitle,
      shift: workerProfiles.shift,
      hireDate: workerProfiles.hireDate,
      skills: workerProfiles.skills,
      employmentStatus: workerProfiles.employmentStatus,
      notes: workerProfiles.notes,
      updatedAt: workerProfiles.updatedAt,
    })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .leftJoin(workerProfiles, and(eq(workerProfiles.userId, users.id), eq(workerProfiles.tenantId, tenantId)))
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId), restrictToInternal ? internalOnly : undefined));
  if (!row) throw AppError.notFound("Worker");
  return toView(row);
}

/** Looking up SOMEONE ELSE (the `/workers/:userId` routes) — excludes external supplier/customer accounts; they're never a member of anyone's workforce roster. */
export async function getWorkerProfile(db: TenantDb, tenantId: number, userId: number): Promise<WorkerProfileView> {
  return loadOne(db, tenantId, userId, true);
}

/** `/workers/me` — always the caller's own row, from their own verified JWT. No external-role exclusion: there's no privacy concern in a person, of any role, seeing their own mostly-empty profile. */
export async function getOwnWorkerProfile(db: TenantDb, tenantId: number, userId: number): Promise<WorkerProfileView> {
  return loadOne(db, tenantId, userId, false);
}

/** Whether a `worker_profiles` row exists yet — distinct from `getWorkerProfile`, which always returns a view (defaults filled in) as long as the user themselves exists. Used only to label an audit entry "create" vs "update" correctly. */
export async function profileRowExists(db: TenantDb, tenantId: number, userId: number): Promise<boolean> {
  const [row] = await db.select({ id: workerProfiles.id }).from(workerProfiles).where(and(eq(workerProfiles.tenantId, tenantId), eq(workerProfiles.userId, userId)));
  return !!row;
}

export async function getWorkerActivity(db: TenantDb, tenantId: number, userId: number): Promise<CalendarItem[]> {
  // Confirm the target user is a real, internal member of this tenant before aggregating — the same isolation check
  // getWorkerProfile does, so a permission-holding caller still can't probe another tenant's (or an external) user id.
  await getWorkerProfile(db, tenantId, userId);
  return getItemsForUser(db, tenantId, userId);
}

/** `/workers/me`'s activity half — always the caller's own id, so no existence/role re-check is needed; requireAuth + withTenantDb already guarantee it. */
export async function getOwnWorkerActivity(db: TenantDb, tenantId: number, userId: number): Promise<CalendarItem[]> {
  return getItemsForUser(db, tenantId, userId);
}

export interface UpsertWorkerProfileInput {
  jobTitle?: string | null;
  shift?: string | null;
  hireDate?: Date | null;
  skills?: string[];
  employmentStatus?: EmploymentStatus;
  notes?: string | null;
}

export async function upsertWorkerProfile(db: TenantDb, tenantId: number, userId: number, input: UpsertWorkerProfileInput, updatedBy: number): Promise<WorkerProfileView> {
  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId), internalOnly));
  if (!target) throw AppError.notFound("Worker");

  await db
    .insert(workerProfiles)
    .values({ tenantId, userId, ...input, updatedBy })
    .onConflictDoUpdate({
      target: [workerProfiles.tenantId, workerProfiles.userId],
      set: { ...input, updatedBy, updatedAt: new Date() },
    });

  return loadOne(db, tenantId, userId, true);
}
