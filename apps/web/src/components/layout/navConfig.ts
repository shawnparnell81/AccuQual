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
  Palette,
  FileUp,
  Bot,
  Cpu,
  TrendingUp,
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
} from "lucide-react";

/**
 * Single source of truth for the top nav, generated from
 * "Subfolder links.xlsx" (Department | Subfolder | Appears In | Read | Write |
 * Edit | Behavior | KPI | Priority | Notes). Every leaf below carries the
 * sheet's row(s) for that subfolder verbatim in `access`/`kpi`/`notes`; a
 * subfolder that appears on more than one sheet row (Suppliers, Complaints,
 * Production Log) is declared once and referenced from every department that
 * holds it, so the dropdowns can never disagree about the same module.
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
// PR Justification / Onboarding / ERP Automation review).
export const WORK_ORDERS: NavLeaf = {
  key: "work_orders",
  label: "Work Orders",
  path: "/work-orders",
  icon: Hammer,
  access: { production: "edit", material_management: "read", purchasing: "read", quality: "read" },
  kpi: false,
  priority: 2,
  notes: "Not in the department sheet — a new production Work Orders module",
};

// Not a sheet row — a new module (Purchase Orders' pre-approval sibling).
// Mirrors departmentAccess.ts's PERMISSION_MATRIX.purchase_requisitions —
// every requesting department gets "edit" (raise/edit their own draft);
// approve/reject/convert-to-PO are purchasing-only, enforced inline in
// erp.controller.ts, same as every other narrower-than-matrix action in
// this app.
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
// ships one combined page for both — see ASSUMPTIONS. Both leaves point at
// the same route until a dedicated APQP page exists.
const PPAP: NavLeaf = {
  key: "ppap",
  label: "PPAP",
  path: "/ppap",
  icon: ClipboardList,
  access: { engineering: "edit" },
  kpi: false,
  priority: 1,
  notes: "Engineering core module",
};
const APQP: NavLeaf = {
  key: "apqp",
  label: "APQP",
  path: "/ppap",
  icon: FileSearch2,
  access: { engineering: "edit" },
  kpi: false,
  priority: 1,
  notes: "Engineering planning module (shares the PPAP page until a dedicated APQP view ships)",
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
    ],
  },
  {
    department: "engineering",
    items: [PPAP, APQP, COMPLAINTS, RMA, PURCHASE_REQUISITIONS, SALES_ACCOUNTS, CUSTOMERS],
  },
  {
    department: "production",
    items: [PRODUCTION_LOG, COMPLAINTS, INVENTORY, SUPPLIERS, WORK_ORDERS, PURCHASE_REQUISITIONS],
  },
  {
    department: "customer_service",
    items: [PRODUCTION_LOG, COMPLAINTS],
  },
  {
    department: "purchasing",
    items: [SUPPLIERS, INVENTORY, ERP, RMA, WORK_ORDERS, PURCHASE_REQUISITIONS],
  },
  {
    department: "material_management",
    items: [SUPPLIERS, INVENTORY, ERP, RMA, WORK_ORDERS, PURCHASE_REQUISITIONS],
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
      },
      { key: "training", label: "Training", path: "/training", icon: GraduationCap, access: {}, kpi: false, priority: 3, notes: "Not in the department sheet — unchanged access" },
      { key: "change", label: "Change Mgmt", path: "/change", icon: GitBranch, access: {}, kpi: false, priority: 3, notes: "Not in the department sheet — unchanged access" },
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
      },
      {
        key: "qms_forms",
        label: "QMS Forms",
        path: "/qms-forms",
        icon: LibraryBig,
        // Deliberately ungated, same as "documents"/"document_change_requests" above.
        access: {},
        kpi: false,
        priority: 3,
        notes: "Not in the department sheet — the generic 'ACCUQUAL Forms' batch (22 form types across every department), each also reachable from its own real Document Folders subfolder",
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
      },
      {
        key: "feasibility",
        label: "Feasibility Review",
        path: "/feasibility",
        icon: Gauge,
        // Mirrors departmentAccess.ts PERMISSION_MATRIX.feasibility exactly — same reasoning as the risk leaf above.
        access: { quality: "edit", engineering: "edit", production: "edit", purchasing: "edit", material_management: "edit" },
        kpi: false,
        priority: 3,
        notes: "Not in the department sheet — new unified module across NCR/Supplier/Complaints/PPAP/Change/WorkOrders/Requisitions/PO/RMA",
      },
      { key: "mgmt_system", label: "Management System", path: "/management-system", icon: Landmark, access: {}, kpi: false, priority: 3, notes: "Not in the department sheet — unchanged access" },
      { key: "workflow", label: "Workflow Builder", path: "/workflow", icon: Workflow, access: {}, kpi: false, priority: 3, notes: "Not in the department sheet — unchanged access" },
      { key: "ai", label: "AI Insights", path: "/ai", icon: Sparkles, access: {}, kpi: false, priority: 3, notes: "Not in the department sheet — unchanged access" },
      { key: "digital_twin", label: "Digital Twin", path: "/digital-twin", icon: Boxes, access: {}, kpi: false, priority: 3, notes: "Not in the department sheet — unchanged access" },
      {
        key: "onboarding",
        label: "Onboarding",
        path: "/onboarding",
        icon: Compass,
        access: {},
        kpi: false,
        priority: 3,
        notes: "Not in the department sheet — visible to every department, same as AI Insights/Workflow Builder; POST /onboarding/ai-generate has no department gate either",
      },
      // Admin-only in practice (each page's own AdminOnlyGuard + the real
      // requireRole("admin") backend gate) — access: {} here just means
      // "visible in the nav to every department", same as every other leaf
      // in this catch-all group; there's no role dimension in the nav
      // access model, only department. See the Tenant Admin UI review.
      { key: "tenant_branding", label: "Tenant Branding", path: "/admin/tenant-branding", icon: Palette, access: {}, kpi: false, priority: 3, notes: "Admin only — see AdminOnlyGuard" },
      { key: "tenant_templates", label: "Tenant Templates", path: "/admin/tenant-templates", icon: FileUp, access: {}, kpi: false, priority: 3, notes: "Admin only — see AdminOnlyGuard" },
      { key: "tenant_ai", label: "Tenant AI Config", path: "/admin/tenant-ai", icon: Bot, access: {}, kpi: false, priority: 3, notes: "Admin only — see AdminOnlyGuard" },
      { key: "ai_usage", label: "AI Usage", path: "/admin/ai-usage", icon: TrendingUp, access: {}, kpi: false, priority: 3, notes: "Admin only — see AdminOnlyGuard; BYOK usage dashboard" },
      { key: "digital_twin_setup", label: "Digital Twin Setup", path: "/admin/digital-twin", icon: Cpu, access: {}, kpi: false, priority: 3, notes: "Admin only — see AdminOnlyGuard" },
    ],
  },
];

export const SYSTEM_LABEL = "System";
export const DASHBOARD_LEAF = { key: "dashboard", label: "Dashboard", path: "/", icon: LayoutDashboard };
export const PLATFORM_LEAF = { key: "platform", label: "Platform Admin", path: "/platform", icon: Building2 };

/** Every KPI-flagged leaf's key that a live count exists for (GET /nav/kpi-counts). Pareto and Production Log are KPI="Yes" in the sheet but aren't countable the same way — see nav.controller.ts. */
export const KPI_COUNT_KEYS = ["ncr", "capa", "8d", "di", "complaints"] as const;

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
  return [SUPPLIERS, COMPLAINTS, PRODUCTION_LOG, INVENTORY, ERP, RMA, WORK_ORDERS, PURCHASE_REQUISITIONS, SALES_ACCOUNTS, CUSTOMERS].find((leaf) => leaf.key === key);
}
