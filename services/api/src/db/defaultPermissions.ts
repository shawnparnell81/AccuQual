import type { AccessLevel, Department, ResourceKey } from "../middleware/departmentAccess.js";

/**
 * The ORIGINAL hardcoded PERMISSION_MATRIX — moved out of
 * departmentAccess.ts entirely per explicit user request ("Remove
 * dependency on hardcoded PERMISSION_MATRIX in departmentAccess.ts").
 * departmentAccess.ts's runtime request path no longer imports or reads
 * this file at all; getUserAccessLevel() is pure database lookup now,
 * defaulting to "none" when no row exists.
 *
 * This data still exists — as a SEED fixture, not a runtime fallback. Two
 * consumers, both one-time/setup-time, never per-request:
 *   1. db/backfillDepartmentPermissions.ts — inserts a real
 *      department_permissions row for every existing tenant, for every
 *      (department, module) pair defined here, so every tenant that
 *      existed before this rewrite keeps behaving EXACTLY as it did under
 *      the old hardcoded matrix, with real rows now on file instead of an
 *      implicit fallback.
 *   2. modules/platform/platform.service.ts's createTenant() — seeds the
 *      same rows for a brand-new tenant at creation time, so "no
 *      permissions configured yet" never means "silently locked out of
 *      everything" for a fresh tenant either.
 * Once seeded, a tenant admin's own department_permissions rows (via the
 * Roles & Permissions admin UI) are the only thing getUserAccessLevel ever
 * reads — this file is never consulted again after that point.
 *
 * Original comment, still true of what this describes: source of truth was
 * "Subfolder links.xlsx" (Department | Subfolder | Appears In | Read |
 * Write | Edit | Behavior | KPI | Priority | Notes); mirrored in the web
 * app's navConfig.ts NAV_STRUCTURE (that file's own `access` maps are the
 * same kind of default-only baseline). "edit" = the sheet's Write+Edit
 * columns (both checked together on every row); "read" = Read-only checked
 * with Write/Edit unchecked (Behavior: ReadOnly in the sheet).
 */
export const INITIAL_DEFAULT_PERMISSIONS: Record<ResourceKey, Partial<Record<Department, AccessLevel>>> = {
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
  // Justification / Onboarding / ERP Automation review). Per explicit user
  // request (2026-09-15): Customer Service now owns the work order
  // lifecycle (create/start/complete/cancel, enforced inline in
  // workOrders.controller.ts's assertDepartment) — Production was
  // downgraded to read-only. "General Manager" full access is covered by
  // the existing tenant-admin bypass (isAdmin short-circuits every
  // assertDepartment call), not a new department — there is no distinct
  // "general_manager" department in this app. material_management/
  // purchasing/quality keep read visibility since they each care about
  // production output (stock, what's being produced, traceability to a
  // linked NCR) — unchanged from before.
  work_orders: { customer_service: "edit", production: "read", material_management: "read", purchasing: "read", quality: "read" },
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
  // requireSupplierPortalAccess() instead, never by this matrix (see that
  // function's own comment — there's no configurable "supplier read vs
  // write" tier, since a supplier acting on their own data has no
  // department to key an override off of; supplier_portal.read/write and
  // .rma_request.read/write from the module-specific RBAC brief map onto
  // this existing identity-based gate, not a new database row).
  supplier_portal: { quality: "edit", purchasing: "edit", engineering: "read" },
  // The Customer Return Analysis Report. Quality owns the document end to
  // end (create through its own quality_review stage). Customer Service is
  // read-only per the brief's own RBAC table. Engineering/purchasing (the
  // two of those departments not already covered above) get "edit" here
  // too, so the linking route itself isn't blocked at this router-level
  // gate — but crar.controller.ts's own logic narrows what that actually
  // means for them to "may PATCH only the warrantyId link field, may never
  // touch the form content," same "matrix grants edit, controller narrows
  // per field/action" pattern as RMA's own quality-department carve-out.
  crar: { quality: "edit", customer_service: "read", engineering: "edit", purchasing: "edit" },
  // NEW, separate lever (module-specific RBAC build, 2026-09-16): whether a
  // department can attempt ANY CRAR workflow transition at all — layered on
  // TOP of crar.controller.ts's own STATUS_TRANSITION_DEPARTMENTS (which
  // stage belongs to whom is real workflow-ownership business logic, not a
  // tunable access level, so it stays hardcoded; this is the union of every
  // department that appears in ANY stage of it today, so default behavior
  // is unchanged bit-for-bit).
  crar_workflow: { quality: "edit", engineering: "edit", purchasing: "edit" },
  // Renamed from this module's OLD "rma_log" identity (2026-09-16) — the
  // automated, read-only event trail behind the Supplier Portal RMA Request
  // pipeline (see rmaActivityLog.controller.ts). "rma_log" itself now names
  // the real, manually-maintained customer-return register built in the
  // module-specific RBAC brief — see below.
  rma_activity_log: { quality: "edit", customer_service: "read" },
  // The real RMA Log register (module-specific RBAC build, 2026-09-16) —
  // NOT the automated event trail above. Quality and Customer Service (the
  // front-line customer liaison, per explicit user direction on Work
  // Orders) jointly own it; Engineering/Purchasing/Material Management get
  // read visibility since a customer return can implicate a part they
  // touch. rma_log.status.write and rma_log.linkage.write (below) are
  // separate, narrower levers on top of this base read/write split.
  rma_log: { quality: "edit", customer_service: "edit", engineering: "read", purchasing: "read", material_management: "read" },
  rma_log_status: { quality: "edit", customer_service: "edit" },
  rma_log_linkage: { quality: "edit", customer_service: "edit" },
  // Phase 8 — Quality Inspection Reports had NO RBAC gate at all before
  // this (a real, ungated-since-creation gap, not a deliberate design —
  // see qualityInspectionReports.routes.ts's own old comment). Mirrors the
  // "erp" resource's own split exactly (Quality owns inspection outcomes;
  // Purchasing/Material Management need read visibility since a rejected
  // receiving inspection is their supplier/goods-movement concern too),
  // since incoming inspection is functionally the quality half of the same
  // receiving event erp's own resource key gates the paperwork half of.
  quality_inspection: { quality: "edit", purchasing: "read", material_management: "read" },
  // Phase 9 — the Workflow Builder (`/workflow`) previously had NO RBAC gate
  // at all beyond requireAuth: any authenticated user of any department
  // could create/run a workflow definition that fires real actions
  // (send an email, auto-create an NCR/CAPA) against this tenant's data.
  // Quality owns editing (same "quality owns process/workflow config"
  // reasoning as every other module's disposition-authority role);
  // Engineering gets read visibility since several templates target
  // engineering-relevant modules (8D, document revision).
  workflow: { quality: "edit", engineering: "read" },
  // Sprint 1 fix (accuqual-implementation-sequencing.md) — Document Control
  // previously had NO RBAC gate at all (documents.routes.ts's own old
  // comment explains why: "read-by-everyone, write-by-few," and copying the
  // quality-edit-only pattern other modules use would have blocked every
  // non-quality employee from viewing released documents). Solved without a
  // controller-narrowing workaround: every department gets at least "read"
  // here (nobody loses visibility into released documents — the exact
  // regression the old comment was avoiding), while only the two real
  // document-owning departments (Quality: QMS/SOP content via
  // sop_generator; Engineering: technical/training material) get "edit",
  // so requireDepartmentAccess's existing read-vs-edit split alone already
  // enforces "write-by-few" with zero new controller logic.
  documents: {
    quality: "edit",
    engineering: "edit",
    production: "read",
    customer_service: "read",
    purchasing: "read",
    material_management: "read",
    sales_and_marketing: "read",
  },
  // Customer Contact & Communications Log — closes the Buyer Evaluation's
  // "no communication log" finding. Customer Service (the front-line
  // customer liaison, per explicit user direction on this module) and
  // Quality (owns the linked NCR/Complaint side a conversation is often
  // about) both get full edit; every other department gets read, so a
  // conversation logged against a customer stays visible tenant-wide
  // without letting an unrelated department log entries on someone else's
  // behalf.
  customer_communications: {
    customer_service: "edit",
    quality: "edit",
    engineering: "read",
    production: "read",
    purchasing: "read",
    material_management: "read",
    sales_and_marketing: "read",
  },
  // Was completely ungated before this — a real gap (Full-System Audit
  // finding C1). No department-sheet row exists for this module either, so
  // this follows the same reasoning risk.validation.ts's/feasibility.
  // validation.ts's own department choice already established: Engineering
  // authors/assesses a Product/Process Change Notice, Quality signs off on
  // it, everyone else needs read visibility into what's changing.
  change: {
    engineering: "edit",
    quality: "edit",
    production: "read",
    customer_service: "read",
    purchasing: "read",
    material_management: "read",
    sales_and_marketing: "read",
  },
  // Had NO ResourceKey at all before this — structurally excluded from the
  // permission system, not just mis-wired (Full-System Audit finding C2).
  // Quality owns training-compliance records in a QMS the same way it owns
  // audits/calibration above; every other department gets read so an
  // employee can at least see courses and their own assignment history
  // (GET /training/employee/:userId/history).
  training: {
    quality: "edit",
    engineering: "read",
    production: "read",
    customer_service: "read",
    purchasing: "read",
    material_management: "read",
    sales_and_marketing: "read",
  },
  // Had NO ResourceKey at all before this either (Full-System Audit finding
  // C3) — unlike training above, this one genuinely has no single owning
  // department: qmsFormDefinitions.ts's own 35 form types span 7 different
  // department folders (Quality, Engineering, Production, Purchasing,
  // Material Management, Sales & Marketing, Shipping & Receiving). Every
  // department gets edit — same "any department that can raise one of
  // these gets the shared floor" reasoning purchase_requisitions/risk above
  // already use for a module with no single owner, and zero-behavior-change
  // from today (every employee already could create/edit any of them) so
  // this doesn't newly lock anyone out of a form type they use today — it
  // just makes the module real and tenant-configurable in Roles &
  // Permissions instead of invisible to that system entirely.
  qms_forms: {
    quality: "edit",
    engineering: "edit",
    production: "edit",
    customer_service: "edit",
    purchasing: "edit",
    material_management: "edit",
    sales_and_marketing: "edit",
  },
};
