import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/appError.js";

export type AccessLevel = "none" | "read" | "edit";
export type Department =
  | "quality"
  | "engineering"
  | "production"
  | "customer_service"
  | "purchasing"
  | "material_management";

export type ResourceKey =
  | "ncr"
  | "capa"
  | "eight_d"
  | "di"
  | "audit"
  | "calibration"
  | "pareto"
  | "suppliers"
  | "complaints"
  | "ppap"
  | "apqp"
  | "production_log";

/**
 * Source of truth: "Subfolder links.xlsx" (Department | Subfolder | Appears In |
 * Read | Write | Edit | Behavior | KPI | Priority | Notes). Mirrored in the web
 * app's navConfig.ts NAV_STRUCTURE so the dropdowns and this enforcement can
 * never disagree about who can do what. "edit" = the sheet's Write+Edit
 * columns (both ✔ together on every row); "read" = Read-only ✔ with
 * Write/Edit ✖ (Behavior: ReadOnly in the sheet).
 */
export const PERMISSION_MATRIX: Record<ResourceKey, Partial<Record<Department, AccessLevel>>> = {
  ncr: { quality: "edit" },
  capa: { quality: "edit" },
  eight_d: { quality: "edit" },
  di: { quality: "edit" },
  audit: { quality: "edit" },
  calibration: { quality: "edit" },
  pareto: { quality: "read" },
  suppliers: { quality: "edit", purchasing: "read", material_management: "read" },
  complaints: { quality: "edit", engineering: "edit", production: "read", customer_service: "edit" },
  ppap: { engineering: "edit" },
  apqp: { engineering: "edit" },
  production_log: { production: "read", customer_service: "edit" },
  // Document Control and Training deliberately aren't given a ResourceKey
  // here yet (see the Permissions Dictionary and Phase 6's implementation
  // notes): unlike ncr/capa/audit/calibration/di, these two are read-by-
  // everyone, write-by-few resources, and Training additionally needs a
  // per-row check ("is this your own assignment"), not a whole-department
  // grant. Copying the quality-edit-only pattern here would lock every
  // non-quality employee out of viewing documents or completing their own
  // training — a real regression, not hardening. Left for a deliberate,
  // explicitly-scoped pass instead of guessed here.
};

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Gate a route by department + minimum access level from PERMISSION_MATRIX.
 * platform_admin/admin bypass the matrix entirely (same as today's
 * requireRole checks) — it only constrains department-scoped staff.
 * A user with no department set (operator not yet assigned one, or an
 * external supplier/customer portal account) gets "none" on every resource.
 */
export function requireDepartmentAccess(resourceKey: ResourceKey) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const role = req.user?.roleName;
    if (role === "platform_admin" || role === "admin") return next();

    const department = req.user?.department as Department | null | undefined;
    const level: AccessLevel = (department && PERMISSION_MATRIX[resourceKey][department]) || "none";

    if (level === "none") {
      return next(AppError.forbidden(`No access to '${resourceKey}' for your department`));
    }
    if (level === "read" && !READ_METHODS.has(req.method)) {
      return next(AppError.forbidden(`'${resourceKey}' is read-only for your department`));
    }
    next();
  };
}
