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
  | "customers"
  | "warranty"
  | "supplier_portal"
  | "crar"
  | "rma_log";

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
  // The Warranty module. Customer Service owns intake (a warranty claim
  // starts as a customer contact); Quality owns inspection + the
  // supplier_review/approved/rejected disposition decision (same
  // disposition-authority role it has on NCR/CAPA); Engineering shares
  // inspection duty (real technical failure analysis). Purchasing gets
  // "edit" too — narrower than it sounds, since warranty.controller.ts's
  // own assertDepartment only actually lets Purchasing record cost entries
  // (what a supplier invoice charged), never create a claim or transition
  // its status; the matrix can only grant/deny at the whole-module level
  // (a "read" grant here would block that one real write action), so this
  // is the same "matrix grants edit, controller narrows per action" pattern
  // as rma/risk/feasibility above. material_management stays read-only —
  // it has no write action of its own in this module.
  warranty: { customer_service: "edit", quality: "edit", engineering: "edit", purchasing: "edit", material_management: "read" },
  // The Supplier Portal — the INTERNAL staff side only. Quality owns
  // reviewing/approving what suppliers submit (onboarding docs, PPAP,
  // corrective actions, 8Ds — the same disposition-authority role it has
  // everywhere else); Purchasing gets edit too (messaging + scorecard
  // entry is part of supplier relationship management, already
  // Purchasing's read-level concern on the `suppliers` resource above).
  // Engineering gets read (PPAP/FMEA content is theirs to consult, not
  // approve). This entry never applies to an actual external supplier
  // login — those carry roleName:"supplier" and are gated by
  // requireSupplierPortalAccess() below instead, never by this matrix.
  supplier_portal: { quality: "edit", purchasing: "edit", engineering: "read" },
  // The Customer Return Analysis Report. Quality owns the document end to
  // end (create through its own quality_review stage). Customer Service is
  // read-only per the brief's own RBAC table. The brief also asks for a
  // "Warranty" role to view CRAR and link it to a warranty claim — but
  // AccuQual has no such department (Warranty is a cross-departmental
  // MODULE, not a department a user belongs to: see PERMISSION_MATRIX
  // .warranty above, edited by customer_service/quality/engineering/
  // purchasing). Engineering/purchasing (the two of those departments not
  // already covered above) get "edit" here too, so the linking route
  // itself isn't blocked at this router-level gate — but
  // crar.controller.ts's own assertDepartment narrows what that actually
  // means for them to "may PATCH only the warrantyId link field, may never
  // touch the form content or transition the workflow", same
  // "matrix grants edit, controller narrows per field/action" pattern as
  // RMA's own quality-department carve-out.
  crar: { quality: "edit", customer_service: "read", engineering: "edit", purchasing: "edit" },
  // A read-only Quality/Customer-Service feed of the supplier-RMA
  // pipeline (see rmaLog.controller.ts) — Quality gets edit only in the
  // sense that it's the module's real owner (there's no user-facing write
  // action on the log itself, every row is written by the pipeline, not a
  // person), Customer Service gets its own explicit read grant per the
  // brief.
  rma_log: { quality: "edit", customer_service: "read" },
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

/**
 * Gates the Supplier Portal to its two real audiences:
 *  - an external supplier login (roleName:"supplier") — allowed through
 *    unconditionally here (every controller then MUST scope its queries to
 *    `req.user.supplierId`, never a client-supplied id — see
 *    supplierPortal.controller.ts's own resolveSupplierScope()); rejected
 *    if the account has no supplierId at all (a misconfigured login, not a
 *    real supplier-portal user).
 *  - internal staff, gated exactly like every other module via
 *    PERMISSION_MATRIX.supplier_portal (Quality/Purchasing edit,
 *    Engineering read) through the normal requireDepartmentAccess logic.
 * admin/platform_admin bypass both branches, same as everywhere else.
 */
export function requireSupplierPortalAccess(req: Request, _res: Response, next: NextFunction) {
  const role = req.user?.roleName;
  if (role === "platform_admin" || role === "admin") return next();

  if (role === "supplier") {
    if (!req.user?.supplierId) {
      return next(AppError.forbidden("This supplier login is not linked to a real supplier record"));
    }
    return next();
  }

  const department = req.user?.department as Department | null | undefined;
  const level: AccessLevel = (department && PERMISSION_MATRIX.supplier_portal[department]) || "none";
  if (level === "none") {
    return next(AppError.forbidden("No access to the Supplier Portal for your department"));
  }
  if (level === "read" && !READ_METHODS.has(req.method)) {
    return next(AppError.forbidden("Supplier Portal is read-only for your department"));
  }
  next();
}
