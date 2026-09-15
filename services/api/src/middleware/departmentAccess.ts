import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/appError.js";

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
  | "customers";

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
  // production added for Supplier Performance Analytics (read-only, same
  // level as purchasing/material_management — it had no access at all
  // before this) — see the Supplier Performance Analytics review.
  suppliers: { quality: "edit", purchasing: "read", material_management: "read", production: "read" },
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
  // Not a "Subfolder links.xlsx" row (no sheet row exists for Inventory yet) —
  // added directly per the Inventory module plan. material_management gets
  // full edit (the real owner of stock); purchasing/production get edit too
  // since they each drive real actions (reorder/on-order, consume); quality
  // is read-only. Finer per-action limits (e.g. only production may consume)
  // are enforced inline in inventory.controller.ts, not expressible here.
  inventory: { material_management: "edit", purchasing: "edit", production: "edit", quality: "read" },
  // Not a sheet row — a new module. Purchasing creates/sends/cancels POs;
  // material_management physically receives goods, so it also needs edit
  // (to create Receiving Documents), not just read. Quality gets read
  // visibility, matching its access to every other real-goods-movement
  // module. Which specific actions each department may take (purchasing
  // only for send/cancel, material_management only for receiving) is
  // enforced inline in erp.controller.ts, not expressible here — same
  // pattern as inventory.controller.ts's assertDepartment.
  erp: { purchasing: "edit", material_management: "edit", quality: "read" },
  // Not a sheet row — a new module. purchasing/material_management get
  // "full RMA access" per the RMA module spec; quality's real access is
  // narrower ("can link NCR/CAPA, can add notes, cannot submit or close")
  // than this binary matrix expresses, so it's granted "edit" here and the
  // narrower field-level limit is enforced inline in rma.controller.ts —
  // same pattern as inventory.controller.ts/erp.controller.ts's
  // assertDepartment for per-action nuance this matrix can't express.
  // engineering is read-only, matching the spec exactly.
  rma: { purchasing: "edit", material_management: "edit", quality: "edit", engineering: "read" },
  // Not a sheet row — a new module (see the AI Work Order Planning / PR
  // Justification / Onboarding / ERP Automation review). Production owns
  // the work order lifecycle (create/start/complete/cancel, enforced
  // inline in workOrders.controller.ts's assertDepartment); the other
  // three get read visibility since they each care about production
  // output (material_management for stock, purchasing for what's being
  // produced, quality for traceability to a linked NCR).
  work_orders: { production: "edit", material_management: "read", purchasing: "read", quality: "read" },
  // Not a sheet row — a new module, the real pre-PO request/approval step.
  // Any requesting department can create/edit their own draft (inline
  // check in erp.controller.ts's requisition handlers, since this matrix
  // is per-resource, not per-action); approve/reject/convert-to-PO are
  // purchasing-only, same narrower-than-matrix pattern RMA's quality
  // access already uses.
  purchase_requisitions: { production: "edit", material_management: "edit", quality: "edit", engineering: "edit", purchasing: "edit" },
  // Not a sheet row — the Risk Management module. Every department that can
  // raise or work a risk gets "edit" here (create + propose-mitigation is
  // the shared floor); the real per-action asymmetry the spec calls for
  // ("Quality has full control incl. close/status transitions, Engineering
  // may also update the record's own fields, Production/Purchasing may only
  // add mitigation actions") is narrower than this matrix can express, so
  // it's enforced inline in risk.controller.ts's assertDepartment — same
  // pattern as inventory/erp/rma/work_orders above. Deleting a risk is
  // admin-only, also enforced inline (not a department at all).
  risk: { quality: "edit", engineering: "edit", production: "edit", purchasing: "edit", material_management: "edit" },
  // Not a sheet row — the Feasibility Review module. Rebuilt (per explicit
  // request) as a bespoke document engineering owns; the other four
  // departments only get "edit" here because each owns exactly one fixed
  // sign-off row on the form (PATCH /:id/signoff) — the real narrower rule
  // (full-record edit: engineering only; each other department: its own
  // sign-off fields only) is enforced inline in feasibility.controller.ts's
  // assertDepartment/assertSignoffFieldsAllowed, same "matrix grants edit,
  // controller narrows" pattern as risk/rma/work_orders. material_management
  // dropped — it has no row on this document at all (the docx's sign-off
  // table is Engineering/Quality/Manufacturing/Purchasing/Sales only).
  feasibility: { engineering: "edit", quality: "edit", production: "edit", purchasing: "edit", sales_and_marketing: "edit" },
  // Not a sheet row — the new Sales & Marketing module, and sales_and_marketing's
  // first real PERMISSION_MATRIX entry as a department (see the Sales &
  // Marketing module review — added as ONE department, not split into
  // separate Sales/Marketing gates). quality/engineering get read (they
  // review customer-requirements-linked documents via the existing Document
  // Control approval flow, not this module's own gate). Delete stays
  // admin-only, enforced inline — no department gets it, per the module's
  // own explicit "Admin: delete records" rule (a stricter rule than risk/
  // feasibility's quality-or-admin, kept as literally specified this time).
  sales: { sales_and_marketing: "edit", quality: "read", engineering: "read" },
  // Not a sheet row — the Customer Onboarding module. sales_and_marketing
  // owns the whole case lifecycle (create through activate), same reasoning
  // as its own sales_accounts pipeline — there's no separate "reviewer
  // department" in the spec, so submit/review/approve/reject/activate are
  // all sales_and_marketing (or admin), with ownerId/reviewerId on the
  // record itself distinguishing who did what within that one department.
  // quality/engineering get read visibility (they consult it when raising a
  // linked Risk/Feasibility review — see customers.ts's relatedSourceType),
  // same level as the sales module above. Delete stays admin-only, enforced
  // inline in customers.controller.ts — same stricter rule as sales.
  customers: { sales_and_marketing: "edit", quality: "read", engineering: "read" },
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

/**
 * Gate a route to admin (platform_admin/admin) or one of a fixed list of
 * departments, full stop — for settings-style endpoints that don't fit the
 * ResourceKey/PERMISSION_MATRIX shape above (a resource other departments
 * can read/edit at *different levels*). Tenant-wide config either belongs to
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
