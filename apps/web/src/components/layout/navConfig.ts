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
  | "material_management";

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
];

// ---- canonical leaves shared across more than one department's dropdown ----

export const SUPPLIERS: NavLeaf = {
  key: "suppliers",
  label: "Suppliers",
  path: "/suppliers",
  icon: Truck,
  access: { quality: "edit", purchasing: "read", material_management: "read" },
  kpi: false,
  priority: 2,
  notes: "Linked to Purchasing + Material Mgmt",
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
    ],
  },
  {
    department: "engineering",
    items: [PPAP, APQP, COMPLAINTS],
  },
  {
    department: "production",
    items: [PRODUCTION_LOG, COMPLAINTS],
  },
  {
    department: "customer_service",
    items: [PRODUCTION_LOG, COMPLAINTS],
  },
  {
    department: "purchasing",
    items: [SUPPLIERS],
  },
  {
    department: "material_management",
    items: [SUPPLIERS],
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
      { key: "risk", label: "Risk / FMEA", path: "/risk", icon: ShieldAlert, access: {}, kpi: false, priority: 3, notes: "Not in the department sheet — unchanged access" },
      { key: "mgmt_system", label: "Management System", path: "/management-system", icon: Landmark, access: {}, kpi: false, priority: 3, notes: "Not in the department sheet — unchanged access" },
      { key: "workflow", label: "Workflow Builder", path: "/workflow", icon: Workflow, access: {}, kpi: false, priority: 3, notes: "Not in the department sheet — unchanged access" },
      { key: "ai", label: "AI Insights", path: "/ai", icon: Sparkles, access: {}, kpi: false, priority: 3, notes: "Not in the department sheet — unchanged access" },
      { key: "digital_twin", label: "Digital Twin", path: "/digital-twin", icon: Boxes, access: {}, kpi: false, priority: 3, notes: "Not in the department sheet — unchanged access" },
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
  return [SUPPLIERS, COMPLAINTS, PRODUCTION_LOG].find((leaf) => leaf.key === key);
}
