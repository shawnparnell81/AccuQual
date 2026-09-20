import type { NextFunction, Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../utils/appError.js";
import { pool } from "../db/index.js";
import type { TenantDb } from "../lib/tenantScope.js";
import { recordAuditTrailStandalone } from "../modules/audit-trail/audit-trail.service.js";
import { getUserAccessLevel, type AccessLevel, type ResourceKey } from "./departmentAccess.js";

/**
 * `requirePermission("workflow.edit")` — a "<subject>.<action>" permission
 * name resolved onto this app's real, tenant-configurable access model rather
 * than a second, parallel permission system:
 *
 *   view     -> "read" access to the subject's resource (Roles & Permissions)
 *   edit     -> "edit" access to it
 *   review   -> "edit" access AND a reviewer role (admin or quality_manager)
 *   publish  -> "edit" access AND a reviewer role (admin or quality_manager)
 *
 * So a tenant admin still controls who may edit a workflow through the
 * Roles & Permissions screen; "review" and "publish" additionally require the
 * reviewer role, so drafting rights alone can never put a change into force.
 * Customers and suppliers (external logins) are always refused.
 */
export const PERMISSION_SUBJECTS = {
  workflow: { resource: "workflow", entityType: "WorkflowVersion" },
  managementReview: { resource: "management_review", entityType: "ManagementReviewVersion" },
  context: { resource: "context_of_org", entityType: "ContextVersion" },
} as const satisfies Record<string, { resource: ResourceKey; entityType: string }>;

export type PermissionSubject = keyof typeof PERMISSION_SUBJECTS;
export type PermissionAction = "view" | "edit" | "review" | "publish";
export type PermissionName = `${PermissionSubject}.${PermissionAction}`;

export const REVIEWER_ROLES = new Set(["admin", "platform_admin", "quality_manager"]);
const EXTERNAL_ROLES = new Set(["customer", "supplier"]);

const NEEDED_LEVEL: Record<PermissionAction, AccessLevel> = { view: "read", edit: "edit", review: "edit", publish: "edit" };
const RANK: Record<AccessLevel, number> = { none: 0, read: 1, edit: 2 };

export function parsePermission(name: string): { subject: PermissionSubject; action: PermissionAction } {
  const [subject, action] = name.split(".");
  if (!subject || !action || !(subject in PERMISSION_SUBJECTS) || !(action in NEEDED_LEVEL)) throw new Error(`Unknown permission "${name}"`);
  return { subject: subject as PermissionSubject, action: action as PermissionAction };
}

/** The decision itself, separate from Express so it is unit-testable and reusable inside services. */
export async function hasPermission(
  db: TenantDb,
  tenantId: number,
  user: { id: number; roleName: string | null; department: string | null },
  name: PermissionName,
): Promise<{ allowed: boolean; reason?: string }> {
  const { subject, action } = parsePermission(name);
  if (user.roleName && EXTERNAL_ROLES.has(user.roleName)) return { allowed: false, reason: "External accounts cannot use this feature" };

  const level = await getUserAccessLevel(db, tenantId, user, PERMISSION_SUBJECTS[subject].resource);
  if (RANK[level] < RANK[NEEDED_LEVEL[action]]) return { allowed: false, reason: `Requires ${NEEDED_LEVEL[action]} access to ${PERMISSION_SUBJECTS[subject].resource}` };
  if ((action === "review" || action === "publish") && !(user.roleName && REVIEWER_ROLES.has(user.roleName))) {
    return { allowed: false, reason: "Reviewing and publishing require an admin or quality manager" };
  }
  return { allowed: true };
}

/** Express gate. A refusal is written to the audit trail (permission_denied) as well as returned as a 403. */
export function requirePermission(name: PermissionName) {
  const { subject } = parsePermission(name);
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !req.db || req.tenantId === undefined) return next(AppError.forbidden("Missing tenant context"));
    const verdict = await hasPermission(req.db as TenantDb, req.tenantId, req.user, name);
    if (verdict.allowed) return next();

    // Standalone connection: the request transaction is rolled back on a 403, which would take the record with it.
    const idFromPath = Number(req.params.id);
    await recordAuditTrailStandalone(pool, {
      tenantId: req.tenantId,
      entityType: PERMISSION_SUBJECTS[subject].entityType,
      entityId: Number.isFinite(idFromPath) && idFromPath > 0 ? idFromPath : 0,
      action: "permission_denied",
      changes: { permission: name, reason: verdict.reason, method: req.method, path: req.originalUrl.split("?")[0], userRole: req.user.roleName, userDepartment: req.user.department },
      performedBy: req.user.id,
    });
    next(AppError.forbidden(verdict.reason ?? "You don't have permission to do that"));
  });
}
