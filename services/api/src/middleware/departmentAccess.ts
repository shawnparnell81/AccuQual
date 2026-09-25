import type { Request, Response, NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import type { Db } from "../lib/requestDb.js";
import { departmentPermissions, permissionRoleModules, userPermissionRoles } from "../drizzle/schema/permissions.js";

export type AccessLevel = "none" | "read" | "edit";
export type Department =
  | "quality"
  | "engineering"
  | "production"
  | "customer_service"
  | "purchasing"
  | "material_management"
  | "sales_and_marketing";

export type ResourceKey =
  | "ncr"
  | "capa"
  | "eight_d"
  // Full-System Audit finding L3 flagged "di" as naming drift and asked
  // whether to rename it to "quality". Investigated and deliberately NOT
  // renamed: "quality" is already a distinct, meaningful Department value
  // (see the Department union above) — reusing it as a ResourceKey too
  // would create exactly the kind of same-string-different-type confusion
  // this finding is trying to prevent, not fix it. A rename would also
  // break every existing tenant's already-persisted department_permissions
  // rows (moduleName = 'di' is real stored data, not just code) and touch
  // ~6 other call sites (defaultPermissions.ts, quality.routes.ts,
  // audit-trail's ENTITY_TYPE_TO_RESOURCE map, forms.routes.ts's
  // FORM_TYPE_TO_RESOURCE map, nav.controller.ts's KPI key) for a rename
  // that isn't even more correct. MODULE_LABELS below already gives this
  // key its real display name ("Discrepancy Investigation") everywhere a
  // human sees it (Roles & Permissions admin UI included) — "di" the raw
  // key is internal-only and never user-facing, so there's no real UX gap
  // to fix here, just an internal identifier some readers find terse.
  | "di"
  | "audit"
  | "calibration"
  | "pareto"
  | "suppliers"
  | "complaints"
  | "ppap"
  | "apqp"
  | "production_log"
  | "inventory"
  | "erp"
  | "rma"
  | "work_orders"
  | "purchase_requisitions"
  | "risk"
  | "feasibility"
  | "sales"
  | "customers"
  | "warranty"
  | "supplier_portal"
  | "crar"
  | "crar_workflow"
  | "rma_log"
  | "rma_log_status"
  | "rma_log_linkage"
  | "rma_activity_log"
  | "quality_inspection"
  | "workflow"
  | "management_review"
  | "context_of_org"
  | "documents"
  | "customer_communications"
  | "change"
  | "training"
  | "qms_forms"
  | "scar"
  | "quarantine"
  | "worker_profile";

export const DEPARTMENTS: Department[] = ["quality", "engineering", "production", "customer_service", "purchasing", "material_management", "sales_and_marketing"];

/** Friendly labels for the Roles & Permissions admin UI's modules list — the real, complete, fixed set ("no fictional modules": a tenant can only configure access to a module that actually has a requireDepartmentAccess/requireSupplierPortalAccess gate on it, never an invented name). */
export const MODULE_LABELS: Record<ResourceKey, string> = {
  ncr: "NCR",
  capa: "CAPA",
  eight_d: "8D",
  di: "Discrepancy Investigation",
  audit: "Audit",
  calibration: "Calibration",
  pareto: "Pareto Analysis",
  suppliers: "Suppliers",
  complaints: "Complaints",
  ppap: "PPAP",
  apqp: "APQP",
  production_log: "Production Log",
  inventory: "Inventory",
  erp: "Purchase Orders (ERP)",
  rma: "RMA / RGA",
  work_orders: "Work Orders",
  purchase_requisitions: "Purchase Requisitions",
  risk: "Risk / FMEA",
  feasibility: "Feasibility Review",
  sales: "Sales Accounts",
  customers: "Customer Onboarding",
  warranty: "Warranty",
  supplier_portal: "Supplier Portal",
  crar: "Customer Return Analysis (CRAR)",
  crar_workflow: "CRAR — Workflow Transitions",
  rma_log: "RMA Log",
  rma_log_status: "RMA Log — Status Changes",
  rma_log_linkage: "RMA Log — Warranty/Supplier Linkage",
  rma_activity_log: "RMA Activity Log (automated event trail)",
  quality_inspection: "Quality Inspection Reports",
  workflow: "Workflow Builder",
  management_review: "Management Review",
  context_of_org: "Context of the Organization",
  documents: "Document Control",
  customer_communications: "Customer Communications",
  change: "Change / PCN Control",
  training: "Training",
  qms_forms: "QMS Forms",
  scar: "SCAR (Supplier Corrective Action Request)",
  quarantine: "Quarantine",
  worker_profile: "Worker Profiles",
};
export const RESOURCE_KEYS: ResourceKey[] = Object.keys(MODULE_LABELS) as ResourceKey[];

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const LEVEL_RANK: Record<AccessLevel, number> = { none: 0, read: 1, edit: 2 };
function higherLevel(a: AccessLevel, b: AccessLevel): AccessLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

/**
 * Isolates source 1 alone (the department baseline) — exported so the admin
 * UI's "view a user's effective permissions" report can show this figure
 * separately from custom-role grants. Pure database lookup now — no
 * hardcoded fallback lives in this file anymore (see
 * db/defaultPermissions.ts's own comment on where that data went and why:
 * it's a one-time seed fixture consumed by db/backfillDepartmentPermissions.ts
 * and platform.service.ts's createTenant(), never read at request time). A
 * tenant with no row for this (department, module) pair simply has no
 * access to it — "none" — full stop.
 */
export async function getDepartmentAccessLevel(db: Db, department: Department | null, moduleName: ResourceKey): Promise<AccessLevel> {
  if (!department) return "none";
  const [row] = await db
    .select({ accessLevel: departmentPermissions.accessLevel })
    .from(departmentPermissions)
    .where(and(eq(departmentPermissions.departmentName, department), eq(departmentPermissions.moduleName, moduleName)));
  return row ? (row.accessLevel as AccessLevel) : "none";
}

/** Isolates source 2 alone (every custom permission-role grant this user holds for this module, at its highest level) — same reasoning as getDepartmentAccessLevel above. */
export async function getRoleGrantedAccessLevel(db: Db, userId: number, moduleName: ResourceKey): Promise<AccessLevel> {
  const roleRows = await db
    .select({ accessLevel: permissionRoleModules.accessLevel })
    .from(userPermissionRoles)
    .innerJoin(permissionRoleModules, and(eq(permissionRoleModules.roleId, userPermissionRoles.roleId), eq(permissionRoleModules.moduleName, moduleName)))
    .where(and(eq(userPermissionRoles.userId, userId)));
  return roleRows.reduce<AccessLevel>((best, r) => higherLevel(best, r.accessLevel as AccessLevel), "none");
}

/**
 * The real, live permission check — everything in this file funnels
 * through this one function. Computes a user's effective access to a
 * module as the HIGHER of two independent, additive sources (never
 * subtractive — there's no way for either source to take away what the
 * other grants):
 *
 *   1. Department baseline (getDepartmentAccessLevel above) — pure
 *      database lookup, "none" if no row exists.
 *   2. Custom role grants (getRoleGrantedAccessLevel above) — every
 *      permissionRoleModules row for any permissionRole this user is
 *      assigned to that names this moduleName.
 *
 * admin/platform_admin bypass both sources entirely and always get "edit".
 * This is a live DB read on every call (no caching) — unlike roleName/
 * department, which are baked into the JWT at login and only change on the
 * next token refresh, a tenant admin's permission change here takes effect
 * on this user's very next request.
 */
export async function getUserAccessLevel(
  db: Db,
  user: { id: number; roleName: string | null; department: string | null },
  moduleName: ResourceKey
): Promise<AccessLevel> {
  if (user.roleName === "admin" || user.roleName === "platform_admin") return "edit";

  const [deptLevel, roleLevel] = await Promise.all([
    getDepartmentAccessLevel(db, user.department as Department | null, moduleName),
    getRoleGrantedAccessLevel(db, user.id, moduleName),
  ]);

  return higherLevel(deptLevel, roleLevel);
}

/**
 * Gate a route by department/role-granted access — the real, live check now
 * lives in getUserAccessLevel() above; this is just the same Express
 * middleware shape every route file already calls (zero call-site changes
 * anywhere in the app). platform_admin/admin bypass entirely, same as
 * always. Wrapped in asyncHandler since this now needs a real DB read.
 */
export function requireDepartmentAccess(resourceKey: ResourceKey) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const role = req.user?.roleName;
    if (role === "platform_admin" || role === "admin") return next();
    if (!req.user || !req.db || req.tenantId === undefined) return next(AppError.forbidden(`No access to '${resourceKey}' for your department`));

    const level = await getUserAccessLevel(req.db as Db, req.user, resourceKey);

    if (level === "none") {
      return next(AppError.forbidden(`No access to '${resourceKey}' for your department`));
    }
    if (level === "read" && !READ_METHODS.has(req.method)) {
      return next(AppError.forbidden(`'${resourceKey}' is read-only for your department`));
    }
    next();
  });
}

/**
 * Gate a route to admin (platform_admin/admin) or one of a fixed list of
 * departments, full stop — for settings-style endpoints that don't fit the
 * ResourceKey/getUserAccessLevel shape above (a resource other departments
 * can read/edit at *different levels*). Not part of the self-service Roles &
 * Permissions module at all (deliberately — these gates aren't keyed by a
 * ResourceKey/moduleName, just a fixed department list per endpoint, so
 * there's no per-module row for a tenant admin to configure). Tenant-wide
 * config either belongs to
 * the department(s) that own it, or an admin — there's no "read-only"
 * tier. See modules/settings/settings.routes.ts for the concrete use
 * (Feasibility settings: quality/engineering; Inventory settings:
 * production/purchasing; ERP Sync: admin only, via requireRole instead).
 */
export function requireAnyDepartment(...departments: Department[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const role = req.user?.roleName;
    if (role === "platform_admin" || role === "admin") return next();

    const department = req.user?.department as Department | null | undefined;
    if (department && departments.includes(department)) return next();

    next(AppError.forbidden(`Requires one of departments: ${departments.join(", ")} (or admin)`));
  };
}

/**
 * Gates the Supplier Portal to its two real audiences:
 *  - an external supplier login (roleName:"supplier") — allowed through
 *    unconditionally here (every controller then MUST scope its queries to
 *    `req.user.supplierId`, never a client-supplied id — see
 *    supplierPortal.controller.ts's own resolveSupplierScope()); rejected
 *    if the account has no supplierId at all (a misconfigured login, not a
 *    real supplier-portal user).
 *  - internal staff, gated exactly like every other module via
 *    getUserAccessLevel(..., "supplier_portal") (Quality/Purchasing edit,
 *    Engineering read, by default — self-service configurable per tenant
 *    same as everything else now).
 * admin/platform_admin bypass both branches, same as everywhere else.
 */
export const requireSupplierPortalAccess = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const role = req.user?.roleName;
  if (role === "platform_admin" || role === "admin") return next();

  if (role === "supplier") {
    if (!req.user?.supplierId) {
      return next(AppError.forbidden("This supplier login is not linked to a real supplier record"));
    }
    return next();
  }

  if (!req.user || !req.db || req.tenantId === undefined) return next(AppError.forbidden("No access to the Supplier Portal for your department"));

  const level = await getUserAccessLevel(req.db as Db, req.user, "supplier_portal");
  if (level === "none") {
    return next(AppError.forbidden("No access to the Supplier Portal for your department"));
  }
  if (level === "read" && !READ_METHODS.has(req.method)) {
    return next(AppError.forbidden("Supplier Portal is read-only for your department"));
  }
  next();
});
