import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Building2,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  FileEdit,
  FileSpreadsheet,
  FileSearch,
  FileText,
  Folder,
  FolderTree,
  Gauge,
  GitBranch,
  GraduationCap,
  Bell,
  Boxes,
  Cog,
  Compass,
  Factory,
  Hammer,
  History,
  LayoutDashboard,
  PieChart,
  RotateCcw,
  ScrollText,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  MessageSquareWarning,
  Sparkles,
  Truck,
  Upload,
  UserPlus,
  Users,
  Workflow,
  Wrench,
} from "lucide-react";

export interface SidebarLink {
  key: string;
  label: string;
  path: string;
  icon: LucideIcon;
  /** Company administrators only. */
  adminOnly?: boolean;
  /** Owner, Administrator, and Quality Manager. */
  auditLog?: boolean;
  /** Opens in a new browser tab. `path` is an absolute URL, not an AccuQual route. */
  external?: boolean;
}

/** Workload tracker hosted outside AccuQual. A link-out only: no embed and no shared login. */
export const ENGINEERING_PLANNER_URL = "https://mtollefson-rgb.github.io/Engineering-Planner/";

export function isExternalHref(path: string): boolean {
  return /^https?:\/\//i.test(path);
}

export function sidebarLinkOpensNewTab(link: Pick<SidebarLink, "external" | "path">): boolean {
  return link.external === true || isExternalHref(link.path);
}

export interface SidebarFolder {
  key: string;
  label: string;
  icon: LucideIcon;
  /** When set, the folder name itself opens this page (in addition to its children). */
  path?: string;
  adminOnly?: boolean;
  auditLog?: boolean;
  children: SidebarNode[];
}

export type SidebarNode = SidebarLink | SidebarFolder;

export function isFolder(node: SidebarNode): node is SidebarFolder {
  return "children" in node;
}

/**
 * Rows that stay on the menu for every person.
 * Home is always the first item and always opens /home.
 */
export const LOCKED_SIDEBAR_KEYS = ["home"] as const;

export function isLockedSidebarKey(key: string): boolean {
  return (LOCKED_SIDEBAR_KEYS as readonly string[]).includes(key);
}

/**
 * Footer links. They are not part of the customizable menu, so a saved
 * layout cannot hide, reorder, or replace them. Settings is the account
 * and company door and stays at the bottom in every layout.
 */
export const PERMANENT_SIDEBAR_LINKS: SidebarLink[] = [
  { key: "settings", label: "Settings", path: "/settings", icon: Settings },
];

/** Category stored on documents that live in Quality → Obsolete / Archive. */
export const OBSOLETE_ARCHIVE_CATEGORY = "obsolete-archive" as const;

/** Document folders for sidebar entries that have no module of their own. Category is stored on the controlled document. */
export const DOCUMENT_FOLDER_PAGES: Record<string, { title: string; blurb: string; emphasizeUpload?: boolean }> = {
  drawings: { title: "Drawings", blurb: "Engineering drawings for this company. Upload a file to keep it here." },
  apqp: { title: "APQP", blurb: "APQP packets and gate documents. Upload a file to keep it here." },
  ecn: { title: "ECN", blurb: "Engineering change notices. Upload a file to keep it here." },
  ecr: { title: "ECR", blurb: "Engineering change requests. Upload a file to keep it here." },
  "work-instructions": { title: "Work Instructions", blurb: "Work instructions. Upload a file to keep it here." },
  repairs: { title: "Repairs", blurb: "Repair records and reports. Upload a file to keep it here." },
  "sop-procedures": { title: "Procedures", blurb: "Standard operating procedures. Upload a file to keep it here." },
  "sop-policies": { title: "Policies", blurb: "Company policies. Upload a file to keep it here." },
  "master-tool-list": { title: "Master Tool List", blurb: "The master list of tools and gages. Upload the current list here.", emphasizeUpload: true },
  "audit-plan": { title: "Audit Plan", blurb: "Audit plans. Upload a file to keep it here." },
  "audit-schedule": { title: "Audit Schedule", blurb: "Audit schedules. Upload a file to keep it here." },
  "audit-checklist": { title: "Audit Checklist", blurb: "Audit checklists. Upload a file to keep it here." },
  "audit-report": { title: "Audit Report", blurb: "Audit reports. Upload a file to keep it here." },
  "internal-audits": { title: "Internal Audits", blurb: "Internal audits. Upload a file to keep it here." },
  shipping: { title: "Shipping", blurb: "Shipping documents. Upload a file to keep it here." },
  receiving: { title: "Receiving", blurb: "Receiving documents. Upload a file to keep it here." },
  "validation-reports": { title: "Validation Reports", blurb: "Process and product validation reports. Start a fillable CSA, Fuel Pump, Air Strut, Air Spring, Fuel Injector, Brake Wear Sensor, Shock, Air Compressor, Electric Lift Support, Gas Lift Support, or Coil Spring validation here, or upload a file to keep it in this folder." },
  "product-alerts": { title: "Product Alerts", blurb: "Product alerts. Upload a file to keep it here." },
  recalls: { title: "Recalls", blurb: "Product recalls. Upload a file to keep it here." },
  [OBSOLETE_ARCHIVE_CATEGORY]: { title: "Obsolete / Archive", blurb: "Old documents. Upload a file to keep it here, or move a superseded document into this folder." },
};

function doc(key: keyof typeof DOCUMENT_FOLDER_PAGES, icon: LucideIcon): SidebarLink {
  const page = DOCUMENT_FOLDER_PAGES[key]!;
  return { key, label: page.title, path: `/folders/${key}`, icon };
}

const CONTROLLED_LISTS: SidebarFolder = {
  key: "controlled-lists",
  label: "Controlled lists",
  icon: ClipboardList,
  children: [
    { key: "master-document-list", label: "Master Document List", path: "/documents/master-list", icon: FileText },
    { key: "laboratory-scope", label: "Laboratory Scope", path: "/documents/laboratory-scope", icon: FileText },
    { key: "internal-audit-schedule", label: "Internal Audit Schedule", path: "/documents/internal-audit-schedule", icon: ClipboardList },
    { key: "nonconformance-log", label: "Nonconformance Log", path: "/documents/nonconformance-log", icon: ClipboardList },
  ],
};

const DOCUMENT_CONTROL_FOLDER: SidebarFolder = {
  key: "document-control",
  label: "Documents",
  icon: FileText,
  path: "/documents",
  children: [
    { key: "folder-explorer", label: "Folder Explorer", path: "/documents/folders", icon: FolderTree },
    { key: "saved-form-folders", label: "Folders", path: "/form-folders", icon: Folder },
    { key: "blank-forms", label: "Blank Forms", path: "/blank-forms", icon: FileText },
    { key: "dcr", label: "Document changes", path: "/document-change-requests", icon: FileEdit },
    { key: "management-system", label: "Management System", path: "/management-system", icon: Building2 },
    doc("drawings", FileText),
    doc("apqp", ClipboardList),
    doc(OBSOLETE_ARCHIVE_CATEGORY, Archive),
    {
      key: "sop",
      label: "SOP",
      icon: ScrollText,
      children: [doc("sop-procedures", FileText), doc("sop-policies", FileText)],
    },
    CONTROLLED_LISTS,
    { key: "uploads", label: "General Uploads", path: "/documents/uploads", icon: Upload },
  ],
};

const QUALITY_FOLDER: SidebarFolder = {
  key: "quality",
  label: "Quality",
  icon: ShieldCheck,
  children: [
    { key: "training", label: "Training", path: "/training", icon: GraduationCap },
    { key: "workers", label: "Workers", path: "/workers", icon: Users },
    { key: "inspections", label: "Inspections", path: "/quality-inspection-reports", icon: ClipboardCheck },
    doc("product-alerts", FileText),
    doc("recalls", FileText),
    { key: "warranty", label: "Warranty", path: "/warranty", icon: ShieldCheck },
    { key: "customer-complaints", label: "Customer Complaints", path: "/complaints", icon: MessageSquareWarning },
    { key: "labor-claims", label: "Labor Claims", path: "/labor-claims", icon: Wrench },
    doc("repairs", Hammer),
    {
      key: "audits",
      label: "Audits",
      icon: ClipboardCheck,
      path: "/audits",
      children: [
        doc("internal-audits", ClipboardCheck),
        doc("audit-plan", ClipboardList),
        doc("audit-schedule", ClipboardList),
        doc("audit-report", FileText),
      ],
    },
    {
      key: "ncr-capa",
      label: "NCR & CAPA",
      icon: AlertTriangle,
      children: [
        { key: "ncr", label: "NCR", path: "/ncr", icon: AlertTriangle },
        { key: "frm-ncr-001", label: "FRM NCR", path: "/iso-forms/frm-ncr-001", icon: AlertTriangle },
        { key: "capa", label: "CAPA", path: "/capa", icon: ClipboardCheck },
        { key: "8d", label: "8D", path: "/8d", icon: FileSearch },
      ],
    },
    { key: "quarantine", label: "Quarantined items", path: "/quarantine", icon: ShieldAlert },
    { key: "ppap", label: "PPAP Packet", path: "/ppap", icon: ClipboardList },
    { key: "risk", label: "Risk / FMEA", path: "/risk", icon: ShieldAlert },
    { key: "risk-dashboard", label: "Risk dashboard", path: "/risk/dashboard", icon: BarChart3 },
    { key: "process-change", label: "Process Change", path: "/change", icon: GitBranch },
    { key: "crar", label: "Customer Return Analysis", path: "/crar", icon: RotateCcw },
    { key: "workflow", label: "Workflow Builder", path: "/workflow", icon: Workflow },
    { key: "form-builder", label: "Form Builder", path: "/form-builder", icon: FileSpreadsheet },
    { key: "ai", label: "AI Insights", path: "/ai", icon: Sparkles },
  ],
};

const ENGINEERING_FOLDER: SidebarFolder = {
  key: "engineering",
  label: "Engineering",
  icon: Cog,
  children: [
    { key: "feasibility", label: "Feasibility Review", path: "/feasibility", icon: Compass },
    { key: "engineering-planner", label: "Engineering Planner", path: ENGINEERING_PLANNER_URL, icon: CalendarRange, external: true },
    { key: "engineering-request-log", label: "Engineering Request Log", path: "/documents/engineering-request-log", icon: GitBranch },
    doc("ecn", GitBranch),
    doc("ecr", GitBranch),
    doc("work-instructions", ScrollText),
    // Stays in the catalog. filterSidebarByAccess drops it unless the company flag is on.
    { key: "digital-twin", label: "Digital Twin", path: "/digital-twin", icon: Boxes },
  ],
};

const EQUIPMENT_FOLDER: SidebarFolder = {
  key: "equipment",
  label: "Equipment",
  icon: Wrench,
  children: [
    {
      key: "calibration",
      label: "Calibration",
      icon: Gauge,
      path: "/calibration",
      children: [{ key: "master-equipment-list", label: "Master Equipment List", path: "/calibration/master-list", icon: Gauge }],
    },
  ],
};

const SUPPLIERS_FOLDER: SidebarFolder = {
  key: "suppliers",
  label: "Suppliers",
  icon: Truck,
  path: "/suppliers",
  children: [
    { key: "add-supplier", label: "ADD SUPPLIER", path: "/suppliers/new", icon: UserPlus },
    { key: "supplier_portal", label: "Supplier Portal", path: "/supplier-portal", icon: Building2 },
    { key: "scar", label: "SCAR", path: "/scar-forms", icon: ClipboardList },
  ],
};

const ADMIN_FOLDER: SidebarFolder = {
  key: "admin",
  label: "Admin",
  icon: Shield,
  path: "/admin",
  adminOnly: true,
  children: [
    { key: "admin-users", label: "Users & Roles", path: "/admin/users", icon: Users, adminOnly: true },
    { key: "admin-import", label: "Import data", path: "/admin/import", icon: Upload, adminOnly: true },
    { key: "admin-plants", label: "Plants", path: "/admin/plants", icon: Factory, adminOnly: true },
    { key: "admin-permissions", label: "Permissions", path: "/admin/roles-permissions", icon: ShieldCheck, adminOnly: true },
    { key: "admin-login-history", label: "Login History", path: "/admin/login-history", icon: History, adminOnly: true },
    { key: "admin-ai", label: "AI Settings", path: "/admin/ai-settings", icon: Sparkles, adminOnly: true },
    { key: "admin-supplier", label: "Supplier Settings", path: "/admin/supplier-settings", icon: Truck, adminOnly: true },
    { key: "admin-quality", label: "Quality Settings", path: "/admin/quality-settings", icon: ClipboardCheck, adminOnly: true },
    { key: "admin-receiving", label: "Receiving & Inventory", path: "/admin/receiving-inventory-settings", icon: ClipboardList, adminOnly: true },
    { key: "admin-health", label: "System Health", path: "/admin/system-health", icon: ShieldCheck, adminOnly: true },
    { key: "admin-api", label: "API Reference", path: "/admin/api-docs", icon: FileText, adminOnly: true },
    { key: "admin-sso", label: "Single Sign-On", path: "/admin/sso", icon: Shield, adminOnly: true },
    { key: "admin-export", label: "Data Export", path: "/admin/data-export", icon: Archive, adminOnly: true },
    { key: "admin-company", label: "Company Settings", path: "/admin/company-settings", icon: Building2, adminOnly: true },
  ],
};

/**
 * ERP groups on the top bar. Every module the previous sidebar could open
 * stays under one of these groups. Wellman development is added beside
 * Engineering. Customize menu still reorders and hides rows for one person.
 * Documents → Folders and the Folders door both open /form-folders.
 * Blank Forms lists the same templates as Folder Explorer → Blank Forms Templates.
 */
export const SIDEBAR_FOLDERS: SidebarNode[] = [
  {
    key: "home",
    label: "Home",
    icon: LayoutDashboard,
    path: "/home",
    children: [
      { key: "calendar", label: "Calendar", path: "/calendar", icon: CalendarDays },
      { key: "executive", label: "Executive dashboard", path: "/executive", icon: LayoutDashboard },
      { key: "home-kpis", label: "Quality Objectives & KPIs", path: "/kpis", icon: Gauge },
      { key: "notifications", label: "Notifications", path: "/notifications", icon: Bell },
    ],
  },
  DOCUMENT_CONTROL_FOLDER,
  QUALITY_FOLDER,
  ENGINEERING_FOLDER,
  EQUIPMENT_FOLDER,
  SUPPLIERS_FOLDER,
  { key: "form-folders", label: "Folders", path: "/form-folders", icon: Folder },
  {
    key: "reporting",
    label: "Reports",
    icon: BarChart3,
    path: "/reporting",
    children: [
      { key: "pareto", label: "Pareto", path: "/pareto", icon: PieChart },
      { key: "kpis", label: "Quality Objectives & KPIs", path: "/kpis", icon: Gauge },
      { key: "dashboard", label: "Overview", path: "/", icon: LayoutDashboard },
      { key: "imported-data", label: "Imported Data", path: "/reporting/imported-data", icon: Folder },
      { key: "report-import", label: "Import data", path: "/admin/import", icon: Upload },
      { key: "audit-log", label: "Audit log", path: "/audit-log", icon: ScrollText, auditLog: true },
    ],
  },
  ADMIN_FOLDER,
];

/** Drops admin-only entries for everyone else, and folders that would be empty. */
export function visibleSidebar(nodes: SidebarNode[], isAdmin: boolean, extras?: { auditLog?: boolean }): SidebarNode[] {
  const out: SidebarNode[] = [];
  for (const node of nodes) {
    if (node.adminOnly && !isAdmin) continue;
    if (node.auditLog && !extras?.auditLog) continue;
    if (isFolder(node)) {
      const children = visibleSidebar(node.children, isAdmin, extras);
      if (children.length === 0 && !node.path) continue;
      out.push({ ...node, children });
    } else {
      out.push(node);
    }
  }
  return out;
}

export function flattenSidebarLinks(nodes: SidebarNode[] = SIDEBAR_FOLDERS): SidebarLink[] {
  const out: SidebarLink[] = [];
  for (const node of nodes) {
    if (isFolder(node)) {
      if (node.path) out.push({ key: node.key, label: node.label, path: node.path, icon: node.icon, adminOnly: node.adminOnly });
      out.push(...flattenSidebarLinks(node.children));
    } else {
      out.push(node);
    }
  }
  return out;
}

export function sidebarNodeContainsPath(node: SidebarNode, pathname: string): boolean {
  if (!isFolder(node)) return pathMatches(pathname, node.path);
  if (node.path && pathMatches(pathname, node.path)) return true;
  return node.children.some((child) => sidebarNodeContainsPath(child, pathname));
}

export function pathMatches(pathname: string, path: string): boolean {
  if (path === "/") return pathname === "/";
  if (isExternalHref(path)) return false;
  return pathname === path || pathname.startsWith(`${path}/`);
}
