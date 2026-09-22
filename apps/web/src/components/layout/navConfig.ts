import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  ShieldCheck,
  Cog,
  Factory,
  Headset,
  ShoppingCart,
  PackageSearch,
  AlertTriangle,
  ClipboardCheck,
  FileSearch,
  FileSearch2,
  ClipboardList,
  Gauge,
  BarChart3,
  MessageSquareWarning,
  Truck,
  ClipboardSignature,
  Boxes,
  Building2,
  FileText,
  GraduationCap,
  GitBranch,
  ShieldAlert,
  Landmark,
  Workflow,
  Sparkles,
  Package,
  Receipt,
  Undo2,
  Hammer,
  FileSignature,
  Compass,
  Megaphone,
  Handshake,
  UserPlus,
  FileEdit,
  LibraryBig,
  ShieldX,
  UploadCloud,
  Wrench,
  Globe2,
  RotateCcw,
  ScrollText,
  LayoutGrid,
  Users,
} from "lucide-react";

/**
 * Single source of truth for the top nav, generated from
 * "Subfolder links.xlsx" (Department | Subfolder | Appears In | Read | Write |
 * Edit | Behavior | KPI | Priority | Notes). Every leaf below carries the
 * sheet's row(s) for that subfolder verbatim in `access`/`kpi`/`notes`; a
 * subfolder that appears on more than one sheet row (Suppliers, Complaints,
 * Production Log) is declared once and referenced from every department that
 * holds it, so the dropdowns can never disagree about the same module.
 *
 * Since the Roles & Permissions module shipped (backend: departmentAccess.ts
 * getUserAccessLevel, DB-driven), each leaf's `access` map below is no
 * longer the live source of truth for READ/EDIT level — it's now only:
 *   1. The pre-fetch fallback shown for an instant before
 *      GET /permissions/effective resolves (see useEffectivePermissions.ts /
 *      useWorkflowAccess.ts), and
 *   2. What decides which department's dropdown GROUP a leaf structurally
 *      belongs to at all (TopNav.tsx renders each user's own department
 *      group from NAV_STRUCTURE, then filters individual leaves by the
 *      LIVE level).
 * Fully dynamic nav registry (2026-09-15): a tenant admin granting any
 * department edit/read on any module via the Roles & Permissions UI now ALSO
 * gains a real nav dropdown entry for it, not just backend enforcement —
 * see ALL_MODULE_LEAVES below and TopNav.tsx's `extraGrantedLeaves`. The
 * per-department `items` arrays here are still the STRUCTURAL default (what
 * shows up out of the box, and what a leaf's static fallback access is
 * before GET /permissions/effective resolves) — they're just no longer a
 * hard ceiling on what CAN appear.
 */

export type AccessLevel = "none" | "read" | "edit";
export type Department =
  | "quality"
  | "engineering"
  | "production"
  | "customer_service"
  | "purchasing"
  | "material_management"
  | "sales_and_marketing";

export interface NavLeaf {
  key: string;
  label: string;
  path: string;
  icon: LucideIcon;
  /** RWX access level per department that appears in the sheet's "Appears In" column for this row. */
  access: Partial<Record<Department, AccessLevel>>;
  kpi: boolean;
  /** Sort order within a dropdown — lower first (sheet's Priority column, 1-3). */
  priority: 1 | 2 | 3;
  /** Sheet's Notes column, shown as a hover tooltip. */
  notes: string;
  /**
   * Phase 1 System-menu cleanup (buyer evaluation: "admin config buried
   * inside the everyday System menu"). Only meaningful for the System
   * catch-all group (department: null) — every department-owned leaf stays
   * in one flat dropdown as before. "advanced" items are seeded hidden by
   * default for every tenant (see db/defaultNavPreferences.ts /
   * backfillNavPreferences.ts) — a tenant admin can still turn any of them
   * back on from Settings > Navigation, same toggle every other nav item
   * already uses.
   */
  section?: "admin" | "quality" | "advanced";
}

export interface DepartmentMeta {
  key: Department;
  label: string;
  icon: LucideIcon;
  /** Tailwind classes, literal (not composed) so the JIT scanner picks them up. */
  text: string;
  bgSoft: string;
  ring: string;
}

export const DEPARTMENTS: DepartmentMeta[] = [
  { key: "quality", label: "Quality", icon: ShieldCheck, text: "text-teal-700 dark:text-teal-400", bgSoft: "bg-teal-500/10", ring: "ring-teal-500/30" },
  { key: "engineering", label: "Engineering", icon: Cog, text: "text-amber-700 dark:text-amber-400", bgSoft: "bg-amber-500/10", ring: "ring-amber-500/30" },
  { key: "production", label: "Production", icon: Factory, text: "text-slate-700 dark:text-slate-300", bgSoft: "bg-slate-500/10", ring: "ring-slate-500/30" },
  { key: "customer_service", label: "Customer Service", icon: Headset, text: "text-violet-700 dark:text-violet-400", bgSoft: "bg-violet-500/10", ring: "ring-violet-500/30" },
  { key: "purchasing", label: "Purchasing", icon: ShoppingCart, text: "text-emerald-700 dark:text-emerald-400", bgSoft: "bg-emerald-500/10", ring: "ring-emerald-500/30" },
  { key: "material_management", label: "Material Mgmt", icon: PackageSearch, text: "text-orange-800 dark:text-orange-400", bgSoft: "bg-orange-500/10", ring: "ring-orange-500/30" },
  { key: "sales_and_marketing", label: "Sales & Marketing", icon: Megaphone, text: "text-pink-700 dark:text-pink-400", bgSoft: "bg-pink-500/10", ring: "ring-pink-500/30" },
];

// ---- canonical leaves shared across more than one department's dropdown ----

export const SUPPLIERS: NavLeaf = {
  key: "suppliers",
  label: "Suppliers",
  path: "/suppliers",
  icon: Truck,
  // production added for Supplier Performance Analytics — mirrors
  // departmentAccess.ts's PERMISSION_MATRIX.suppliers exactly.
  access: { quality: "edit", purchasing: "read", material_management: "read", production: "read" },
  kpi: false,
  priority: 2,
  notes: "Linked to Purchasing + Material Mgmt + Production (read)",
};

export const COMPLAINTS: NavLeaf = {
  key: "complaints",
  label: "Complaints",
  path: "/complaints",
  icon: MessageSquareWarning,
  access: { quality: "edit", engineering: "edit", production: "read", customer_service: "edit" },
  kpi: true,
  priority: 1,
  notes: "Linked to Quality, Engineering, Customer Service",
};

// Not a "Subfolder links.xlsx" row — the sheet has no Inventory row at all.
// Added per the Inventory module plan, mirroring departmentAccess.ts's
// PERMISSION_MATRIX.inventory entry exactly so this dropdown access and the
// backend's enforcement can't disagree.
export const INVENTORY: NavLeaf = {
  key: "inventory",
  label: "Inventory",
  path: "/inventory",
  icon: Package,
  access: { material_management: "edit", purchasing: "edit", production: "edit", quality: "read" },
  kpi: false,
  priority: 2,
  notes: "Not in the department sheet — added directly (see the Inventory module plan)",
};

// Not a sheet row either — a new, real, standalone ERP module (Purchase
// Orders + Receiving). Mirrors departmentAccess.ts's PERMISSION_MATRIX.erp
// exactly. Purchasing owns the PO lifecycle; material_management owns
// receiving — both get "edit" here, with the specific per-action split
// enforced inline in erp.controller.ts (not expressible as a nav access
// level).
export const ERP: NavLeaf = {
  key: "erp",
  label: "Purchase Orders",
  path: "/erp",
  icon: Receipt,
  access: { purchasing: "edit", material_management: "edit", quality: "read" },
  kpi: false,
  priority: 2,
  notes: "Not in the department sheet — a new ERP module (see the ERP module review)",
};

// Not a sheet row — a new module (Purchase Orders' reverse-direction
// sibling). Mirrors departmentAccess.ts's PERMISSION_MATRIX.rma exactly.
// quality's real access is narrower than "edit" implies (notes/NCR-CAPA
// linkage only, no submit/close) — enforced inline in rma.controller.ts,
// not expressible as a nav access level, same as inventory/erp above.
export const RMA: NavLeaf = {
  key: "rma",
  label: "RMA / RGA",
  path: "/rma",
  icon: Undo2,
  access: { purchasing: "edit", material_management: "edit", quality: "edit", engineering: "read" },
  kpi: false,
  priority: 2,
  notes: "Not in the department sheet — a new RMA/RGA module (see the RMA module review)",
};

// Not a sheet row — a new module. Mirrors departmentAccess.ts's
// PERMISSION_MATRIX.work_orders exactly (see the AI Work Order Planning /
// PR Justification / Onboarding / ERP Automation review). Per explicit user
// request (2026-09-15): Customer Service owns it now; Production is
// read-only. "General Manager" full access is the existing admin bypass,
// not a distinct department — see departmentAccess.ts's own comment.
export const WORK_ORDERS: NavLeaf = {
  key: "work_orders",
  label: "Work Orders",
  path: "/work-orders",
  icon: Hammer,
  access: { customer_service: "edit", production: "read", material_management: "read", purchasing: "read", quality: "read" },
  kpi: false,
  priority: 2,
  notes: "Not in the department sheet — Customer Service owns the work order lifecycle; Production/Material Mgmt/Purchasing/Quality are read-only",
};

// Not a sheet row — a new module (Purchase Orders' pre-approval sibling).
// Mirrors departmentAccess.ts's PERMISSION_MATRIX.purchase_requisitions —
// every requesting department gets "edit" (raise/edit their own draft);
// approve/reject/convert-to-PO are purchasing-only, enforced inline in
// erp.controller.ts, same as every other narrower-than-matrix action in
// this app.
// Not a sheet row — the new Warranty module. Mirrors
// departmentAccess.ts's PERMISSION_MATRIX.warranty exactly. Purchasing's
// "edit" here is narrower than it looks (cost entries only — see
// warranty.controller.ts's own comment); material_management stays
// read-only.
export const WARRANTY: NavLeaf = {
  key: "warranty",
  label: "Warranty",
  path: "/warranty",
  icon: Wrench,
  access: { customer_service: "edit", quality: "edit", engineering: "edit", purchasing: "edit", material_management: "read" },
  kpi: false,
  priority: 2,
  notes: "Not in the department sheet — a new Warranty module (claims, inspection, supplier review, cost tracking)",
};

// Not a sheet row — the internal-staff side of the new Supplier Portal.
// Mirrors departmentAccess.ts's PERMISSION_MATRIX.supplier_portal exactly.
// An actual external supplier login (roleName:"supplier") never sees this
// nav at all — see AppLayout's own supplier-portal branch, which replaces
// the whole department-driven sidebar with a single-purpose shell instead.
export const SUPPLIER_PORTAL: NavLeaf = {
  key: "supplier_portal",
  label: "Supplier Portal",
  path: "/supplier-portal",
  icon: Globe2,
  access: { quality: "edit", purchasing: "edit", engineering: "read" },
  kpi: false,
  priority: 2,
  notes: "Not in the department sheet — internal review/management side of the new Supplier Portal (onboarding, PPAP, CAR/8D responses, messaging)",
};

// Not a sheet row — the new CRAR module. Mirrors departmentAccess.ts's
// PERMISSION_MATRIX.crar exactly. Quality owns the report end to end;
// customer_service is view-only; engineering/purchasing hold "edit" here
// only so their warrantyId-link PATCH isn't blocked at the router — see
// crar.controller.ts's own comment (they're narrowed to that one field
// inline, same asymmetry as Warranty's own nav leaf above).
export const CRAR: NavLeaf = {
  key: "crar",
  label: "Customer Return Analysis",
  path: "/crar",
  icon: RotateCcw,
  access: { quality: "edit", customer_service: "read", engineering: "edit", purchasing: "edit" },
  kpi: false,
  priority: 2,
  notes: "Not in the department sheet — Customer Return Analysis Report (CRAR), integrated with Quality, Warranty and Supplier RMA Requests",
};

// The real, manually-maintained RMA Log register (module-specific RBAC
// build, 2026-09-16) — NOT the automated Supplier RMA Request event trail
// (see RMA_ACTIVITY_LOG below, which held this "rma_log" key/name until
// this build freed it). Mirrors db/defaultPermissions.ts's rma_log entry.
export const RMA_LOG: NavLeaf = {
  key: "rma_log",
  label: "RMA Log",
  path: "/rma-log",
  icon: ScrollText,
  access: { quality: "edit", customer_service: "edit", engineering: "read", purchasing: "read", material_management: "read" },
  kpi: false,
  priority: 2,
  notes: "Not in the department sheet — the real customer-return register (RMA #, disposition, corrective action, etc.), linked to Warranty/Supplier RMA Requests/Quality",
};

// The automated event trail behind every Supplier Portal RMA Request,
// separate from the RMA/RGA module's own record list — renamed from
// "RMA Log" (see RMA_LOG above, which now names the real register).
export const RMA_ACTIVITY_LOG: NavLeaf = {
  key: "rma_activity_log",
  label: "RMA Activity Log",
  path: "/rma-activity-log",
  icon: ScrollText,
  access: { quality: "edit", customer_service: "read" },
  kpi: false,
  priority: 2,
  notes: "Not in the department sheet — event log for Supplier Portal RMA Requests (submission, auto-match, RMA creation, notifications)",
};

export const PURCHASE_REQUISITIONS: NavLeaf = {
  key: "purchase_requisitions",
  label: "Purchase Requisitions",
  path: "/erp/requisitions",
  icon: FileSignature,
  access: { production: "edit", material_management: "edit", quality: "edit", engineering: "edit", purchasing: "edit" },
  kpi: false,
  priority: 2,
  notes: "Not in the department sheet — the real pre-PO request/approval step",
};

export const PRODUCTION_LOG: NavLeaf = {
  key: "production_log",
  label: "Production Log",
  path: "/production-logs",
  icon: ClipboardSignature,
  access: { production: "read", customer_service: "edit" },
  kpi: true,
  priority: 1,
  notes: "Read-only in Production; editable in Customer Service",
};

// Not a sheet row — a new module (Sales & Marketing review). Mirrors
// departmentAccess.ts's PERMISSION_MATRIX.sales exactly: sales_and_marketing
// owns it, quality/engineering get read-only visibility (feasibility/
// change-management context on a linked account), delete is admin-only with
// no department at all (a deliberate contrast to Risk/Feasibility's
// wider admin-or-department delete rule — see sales.controller.ts).
export const SALES_ACCOUNTS: NavLeaf = {
  key: "sales_accounts",
  label: "Sales Accounts",
  path: "/sales",
  icon: Handshake,
  access: { sales_and_marketing: "edit", quality: "read", engineering: "read" },
  kpi: false,
  priority: 2,
  notes: "Not in the department sheet — new CRM-style module (accounts, quotes, contracts)",
};

// Not a sheet row — the Customer Onboarding module. Mirrors
// departmentAccess.ts's PERMISSION_MATRIX.customers exactly — same
// sales_and_marketing-owns-it, quality/engineering-read-only shape as
// SALES_ACCOUNTS above (see the Customer Onboarding module review).
export const CUSTOMERS: NavLeaf = {
  key: "customers",
  label: "Customer Onboarding",
  path: "/customers",
  icon: UserPlus,
  access: { sales_and_marketing: "edit", quality: "read", engineering: "read" },
  kpi: false,
  priority: 2,
  notes: "Not in the department sheet — new qualification workflow (one consolidated customers table, see its own schema comment)",
};

// PPAP and APQP are two distinct rows in the sheet, but the app currently
// ships one combined page for both — see ASSUMPTIONS. Phase 1 cleanup
// (buyer evaluation finding "Unnecessary features"): these used to be two
// separate nav entries both pointing at the exact same /ppap route, reading
// as a duplicate-menu-item bug rather than two real destinations. Nothing
// in the actual PPAP route or page ever checks the separate "apqp"
// ResourceKey (confirmed by reading both) — it's a real, distinct
// permission a tenant admin could still grant in Roles & Permissions, but
// there's no second page for it to gate — so merging the nav down to one
// leaf loses no real access, just the redundant menu row. Revert this back
// to two leaves the moment a dedicated APQP page actually exists.
const PPAP: NavLeaf = {
  key: "ppap",
  label: "PPAP / APQP",
  path: "/ppap",
  icon: ClipboardList,
  access: { engineering: "edit" },
  kpi: false,
  priority: 1,
  notes: "Engineering core module — one page covers both PPAP and APQP until a dedicated APQP view ships",
};

// Rebuilt as a bespoke fixed-structure document (see feasibility.ts's own
// schema comment) and moved here from the System catch-all — per explicit
// request, scoped down to Engineering's own nav entry plus the Customer
// Onboarding packet's own button, not the 9 cross-module integration
// points the earlier scoring-based version had.
const FEASIBILITY: NavLeaf = {
  key: "feasibility",
  label: "Feasibility Review",
  path: "/feasibility",
  icon: Gauge,
  access: { engineering: "edit" },
  kpi: false,
  priority: 1,
  notes: "Not in the department sheet — Engineering's own document; departmentAccess.ts's PERMISSION_MATRIX.feasibility also grants quality/production/purchasing/sales_and_marketing 'edit' for their own sign-off row only (enforced inline, not expressible here)",
};

export interface NavGroup {
  department: Department | null; // null = the unlisted-by-the-sheet "System" catch-all
  items: NavLeaf[];
}

export const NAV_STRUCTURE: NavGroup[] = [
  {
    department: "quality",
    items: [
      { key: "ncr", label: "NCR", path: "/ncr", icon: AlertTriangle, access: { quality: "edit" }, kpi: true, priority: 1, notes: "Core QMS module" },
      { key: "capa", label: "CAPA", path: "/capa", icon: ClipboardCheck, access: { quality: "edit" }, kpi: true, priority: 1, notes: "Auto-linked to NCR" },
      { key: "8d", label: "8D", path: "/8d", icon: FileSearch, access: { quality: "edit" }, kpi: true, priority: 1, notes: "Auto-linked to CAPA" },
      { key: "di", label: "DI", path: "/quality", icon: FileSearch2, access: { quality: "edit" }, kpi: true, priority: 1, notes: "Discrepancy Investigation — auto-linked to CAPA" },
      { key: "audit", label: "Audit", path: "/audits", icon: ClipboardCheck, access: { quality: "edit" }, kpi: false, priority: 2, notes: "Standard audit module" },
      { key: "calibration", label: "Calibration", path: "/calibration", icon: Gauge, access: { quality: "edit" }, kpi: false, priority: 2, notes: "Calibration records" },
      { key: "quarantine", label: "Quarantine", path: "/quarantine", icon: ShieldAlert, access: { quality: "edit", material_management: "edit", production: "read", purchasing: "read" }, kpi: false, priority: 2, notes: "Holds on nonconforming material" },
      { key: "pareto", label: "Pareto Analysis", path: "/pareto", icon: BarChart3, access: { quality: "read" }, kpi: true, priority: 1, notes: "KPI dashboard item" },
      SUPPLIERS,
      COMPLAINTS,
      INVENTORY,
      ERP,
      RMA,
      WORK_ORDERS,
      PURCHASE_REQUISITIONS,
      SALES_ACCOUNTS,
      CUSTOMERS,
      WARRANTY,
      SUPPLIER_PORTAL,
      CRAR,
      RMA_LOG,
      RMA_ACTIVITY_LOG,
    ],
  },
  {
    department: "engineering",
    items: [PPAP, COMPLAINTS, RMA, PURCHASE_REQUISITIONS, SALES_ACCOUNTS, CUSTOMERS, FEASIBILITY, WARRANTY, SUPPLIER_PORTAL, CRAR, RMA_LOG],
  },
  {
    department: "production",
    items: [PRODUCTION_LOG, COMPLAINTS, INVENTORY, SUPPLIERS, WORK_ORDERS, PURCHASE_REQUISITIONS],
  },
  {
    department: "customer_service",
    items: [PRODUCTION_LOG, COMPLAINTS, WARRANTY, CRAR, RMA_LOG, RMA_ACTIVITY_LOG, WORK_ORDERS],
  },
  {
    department: "purchasing",
    items: [SUPPLIERS, INVENTORY, ERP, RMA, WORK_ORDERS, PURCHASE_REQUISITIONS, WARRANTY, SUPPLIER_PORTAL, CRAR, RMA_LOG],
  },
  {
    department: "material_management",
    items: [SUPPLIERS, INVENTORY, ERP, RMA, WORK_ORDERS, PURCHASE_REQUISITIONS, WARRANTY, RMA_LOG],
  },
  {
    department: "sales_and_marketing",
    items: [SALES_ACCOUNTS, CUSTOMERS],
  },
  {
    // Not in the sheet — kept so nothing loses a working page. Access is
    // unchanged from today (whatever the route itself/its own API already
    // enforces), not governed by the department matrix. See ASSUMPTIONS.
    department: null,
    items: [
      {
        key: "documents",
        label: "Document Control",
        path: "/documents",
        icon: FileText,
        access: {},
        kpi: false,
        priority: 3,
        notes: "Master index + controlled-document register — folder browsing lives under Document Library instead",
        section: "quality",
      },
      {
        key: "general_uploads",
        label: "General Uploads",
        path: "/documents/uploads",
        icon: UploadCloud,
        access: {},
        kpi: false,
        priority: 3,
        notes: "Not in the department sheet — the shared bin for a user's own uploads that aren't evidence on a specific record (see AttachmentsPanel)",
        section: "quality",
      },
      { key: "training", label: "Training", path: "/training", icon: GraduationCap, access: {}, kpi: false, priority: 3, notes: "Not in the department sheet — unchanged access", section: "quality" },
      {
        key: "worker_profile",
        label: "Worker Profiles",
        path: "/workers",
        icon: Users,
        // Mirrors defaultPermissions.ts's worker_profile block: Quality edits, every other department can at least look a coworker up.
        access: { quality: "edit", engineering: "read", production: "read", customer_service: "read", purchasing: "read", material_management: "read", sales_and_marketing: "read" },
        kpi: false,
        priority: 3,
        notes: "Worker Runtime — job title/shift/notes on top of `users`, plus what someone is currently assigned to",
        section: "quality",
      },
      {
        key: "reporting",
        label: "Reporting Hub",
        path: "/reporting",
        icon: BarChart3,
        // Ungated at the nav level, same convention as documents/training
        // above — the page itself (ReportingHubPage.tsx) hides each tab
        // per the viewer's real, live access to that tab's underlying
        // module (ncr/suppliers/warranty/inventory), reusing those
        // existing ResourceKeys rather than a new parallel one.
        access: {},
        kpi: false,
        priority: 2,
        notes: "Phase 6 — cross-module dashboards, scheduled reports, exports; per-tab visibility enforced inside the page itself",
        section: "quality",
      },
      { key: "change", label: "Change Mgmt", path: "/change", icon: GitBranch, access: {}, kpi: false, priority: 3, notes: "Not in the department sheet — unchanged access", section: "quality" },
      {
        key: "document_change_requests",
        label: "Document Change Requests",
        path: "/document-change-requests",
        icon: FileEdit,
        // Deliberately ungated, same as "documents" above — Document Control's own convention (documents.routes.ts's own comment).
        access: {},
        kpi: false,
        priority: 3,
        notes: "Not in the department sheet — new QMS-document revision-control form, distinct from Change Mgmt's product/process change_requests",
        section: "quality",
      },
      {
        key: "qms_forms",
        label: "QMS Forms",
        path: "/qms-forms",
        icon: LibraryBig,
        // Backend gate added (Full-System Audit finding C3) — every
        // department gets edit by default, so this nav entry's own
        // unconditional visibility (department: null, like Document
        // Control above) still matches real access for everyone.
        access: {},
        kpi: false,
        priority: 3,
        notes: "Not in the department sheet — the generic 'ACCUQUAL Forms' batch (22 form types across every department), each also reachable from its own real Document Folders subfolder",
        section: "quality",
      },
      {
        key: "scar_forms",
        label: "SCAR Forms",
        path: "/scar-forms",
        icon: ShieldX,
        access: {},
        kpi: false,
        priority: 3,
        notes: "Not in the department sheet — one of the two real gaps the ACCUQUAL Forms batch review reported (a Supplier Corrective Action Request, distinct from a plain Supplier NCR)",
        section: "quality",
      },
      {
        key: "quality_inspection_reports",
        label: "Quality Inspection Reports",
        path: "/quality-inspection-reports",
        icon: ClipboardCheck,
        access: {},
        kpi: false,
        priority: 3,
        notes: "Not in the department sheet — the other real gap the ACCUQUAL Forms batch review reported (fills the generic 'Inspection Forms' placeholder)",
        section: "quality",
      },
      {
        key: "risk",
        label: "Risk / FMEA",
        path: "/risk",
        icon: ShieldAlert,
        // Mirrors departmentAccess.ts PERMISSION_MATRIX.risk exactly — the
        // real per-action asymmetry (update/close narrower than create;
        // delete admin-only) is enforced server-side in risk.controller.ts
        // and client-side inline via useCurrentUser(), same as work_orders.
        access: { quality: "edit", engineering: "edit", production: "edit", purchasing: "edit", material_management: "edit" },
        kpi: false,
        priority: 3,
        notes: "Not in the department sheet — new module, mirrors its own backend PERMISSION_MATRIX entry",
        section: "quality",
      },
      { key: "mgmt_system", label: "Management System", path: "/management-system", icon: Landmark, access: {}, kpi: false, priority: 3, notes: "Not in the department sheet — unchanged access", section: "quality" },
      {
        key: "workflow",
        label: "Workflow Builder",
        path: "/workflow",
        icon: Workflow,
        access: {},
        kpi: false,
        priority: 3,
        notes: "Not in the department sheet — unchanged access. Bare trigger/condition/action form, no visual canvas or run history yet (see the Workflow Engine maturity review) — advanced/technical until that ships.",
        section: "advanced",
      },
      {
        key: "ai",
        label: "AI Insights",
        path: "/ai",
        icon: Sparkles,
        access: {},
        kpi: false,
        priority: 3,
        notes: "Not in the department sheet — unchanged access. A raw pipeline-picker + JSON console today, not a business-facing dashboard yet (see the buyer evaluation) — advanced/technical until that ships.",
        section: "advanced",
      },
      {
        key: "digital_twin",
        label: "Digital Twin",
        path: "/digital-twin",
        icon: Boxes,
        access: {},
        kpi: false,
        priority: 3,
        notes: "Not in the department sheet — unchanged access. Real simulation/results/AI-interpretation code, but no in-app way to create a model yet (\"create one via the API/DB seed\") — a dead end for a real tenant, hidden until that exists.",
        section: "advanced",
      },
      {
        key: "onboarding",
        label: "Onboarding",
        path: "/onboarding",
        icon: Compass,
        access: {},
        kpi: false,
        priority: 3,
        notes: "Not in the department sheet — visible to every department, same as AI Insights/Workflow Builder; POST /onboarding/ai-generate has no department gate either",
        section: "quality",
      },
      // Phase 10 — these 6 separate leaves (Tenant Branding/Templates/AI
      // Config/AI Usage/Digital Twin Setup/Roles & Permissions) collapsed
      // into ONE "Admin Console" entry: the pages themselves are unchanged
      // (each still has its own AdminOnlyGuard + real requireRole("admin")
      // backend gate, and their URLs still work directly) — only the top
      // nav's list of separate shortcuts is consolidated, since the console
      // itself (see AdminConsoleLayout.tsx) now provides that same
      // navigation as a persistent sidebar covering all 10 admin sections,
      // not just these 6.
      {
        key: "admin_console",
        label: "Admin Console",
        path: "/admin",
        icon: LayoutGrid,
        access: {},
        kpi: false,
        priority: 3,
        notes: "Users & roles, permissions, AI/supplier/quality/receiving-inventory settings, system health, tenant settings — each section keeps its own real RBAC, not gated as a block",
        section: "admin",
      },
    ],
  },
];

/**
 * Flat, de-duplicated registry of every leaf that maps to a real,
 * permission-gated module (i.e. has a non-empty `access` map — a real
 * ResourceKey in departmentAccess.ts). The System catch-all's ungated items
 * (Document Control, Training, Workflow Builder, the admin-only pages, etc.)
 * are deliberately excluded: they have no ResourceKey, are always visible to
 * every department already, and aren't something a department gets
 * "granted" in the Roles & Permissions sense.
 *
 * This is what lets TopNav.tsx show a department's dropdown ANY module it's
 * been granted live access to (via department_permissions or a custom
 * permission role), not just the ones structurally pre-wired into that
 * department's own `items` array above.
 */
export const ALL_MODULE_LEAVES: NavLeaf[] = (() => {
  const seen = new Set<string>();
  const out: NavLeaf[] = [];
  for (const group of NAV_STRUCTURE) {
    for (const item of group.items) {
      if (Object.keys(item.access).length === 0) continue;
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      out.push(item);
    }
  }
  return out;
})();

export const SYSTEM_LABEL = "System";
export const DASHBOARD_LEAF = { key: "dashboard", label: "Dashboard", path: "/", icon: LayoutDashboard };
export const PLATFORM_LEAF = { key: "platform", label: "Platform Admin", path: "/platform", icon: Building2 };

/** Every KPI-flagged leaf's key that a live count exists for (GET /nav/kpi-counts). Pareto and Production Log are KPI="Yes" in the sheet but aren't countable the same way — see nav.controller.ts. */
export const KPI_COUNT_KEYS = ["ncr", "capa", "8d", "di", "complaints"] as const;

/**
 * The System group's "advanced" leaves, derived from each leaf's own
 * `section: "advanced"` tag above — used by TopNav.tsx to group the System
 * dropdown into sections. The backend's db/defaultNavPreferences.ts (which
 * seeds these hidden by default for every tenant) can't import this file —
 * apps/web and services/api are separate deployables with no shared
 * package — so it keeps its own copy of these same three key strings, with
 * a comment pointing back here as the source of truth to keep them in sync.
 */
export const SYSTEM_ADVANCED_KEYS = NAV_STRUCTURE.flatMap((g) => g.items).filter((i) => i.section === "advanced").map((i) => i.key);

/**
 * Looks up one leaf by key across every department's dropdown, plus the
 * canonical leaves declared once and shared (SUPPLIERS/COMPLAINTS/
 * PRODUCTION_LOG) — used by the Workflow UI components (useWorkflowAccess)
 * to reuse this same access map for permission-aware transition buttons
 * instead of a second, parallel matrix.
 */
export function findNavLeaf(key: string): NavLeaf | undefined {
  for (const group of NAV_STRUCTURE) {
    const found = group.items.find((item) => item.key === key);
    if (found) return found;
  }
  return [SUPPLIERS, COMPLAINTS, PRODUCTION_LOG, INVENTORY, ERP, RMA, WORK_ORDERS, PURCHASE_REQUISITIONS, SALES_ACCOUNTS, CUSTOMERS, CRAR, RMA_LOG, RMA_ACTIVITY_LOG].find((leaf) => leaf.key === key);
}
