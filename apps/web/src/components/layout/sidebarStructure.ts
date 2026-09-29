import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Building2,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Cog,
  FileEdit,
  FileSearch,
  FileText,
  FolderTree,
  Gauge,
  GitBranch,
  GraduationCap,
  Hammer,
  LayoutDashboard,
  Library,
  PieChart,
  ScrollText,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Truck,
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
  "validation-reports": { title: "Validation Reports", blurb: "Process and product validation reports. Start a fillable CSA Validation Report or Fuel Pump Validation here, or upload a file to keep it in this folder." },
  "product-alerts": { title: "Product Alerts", blurb: "Product alerts. Upload a file to keep it here." },
  recalls: { title: "Recalls", blurb: "Product recalls. Upload a file to keep it here." },
  [OBSOLETE_ARCHIVE_CATEGORY]: { title: "Obsolete / Archive", blurb: "Old documents. Upload a file to keep it here, or move a superseded document into this folder." },
};

function doc(key: keyof typeof DOCUMENT_FOLDER_PAGES, icon: LucideIcon): SidebarLink {
  const page = DOCUMENT_FOLDER_PAGES[key]!;
  return { key, label: page.title, path: `/folders/${key}`, icon };
}

export const SIDEBAR_FOLDERS: SidebarFolder[] = [
  {
    key: "workspace",
    label: "Workspace",
    icon: LayoutDashboard,
    children: [
      { key: "home", label: "Home", path: "/home", icon: LayoutDashboard },
      { key: "calendar", label: "Calendar", path: "/calendar", icon: CalendarDays },
      { key: "reporting", label: "Reporting", path: "/reporting", icon: BarChart3 },
      { key: "pareto", label: "Pareto", path: "/pareto", icon: PieChart },
    ],
  },
  {
    key: "engineering",
    label: "Engineering",
    icon: Cog,
    children: [
      doc("drawings", FileText),
      doc("apqp", ClipboardList),
      { key: "ppap", label: "PPAP Packet", path: "/ppap", icon: ClipboardList },
      { key: "frm-psw-001", label: "Part Submission Warrant", path: "/iso-forms/frm-psw-001", icon: ClipboardList },
      { key: "frm-prc-001", label: "Turtle Diagram", path: "/iso-forms/frm-prc-001", icon: FileText },
      { key: "fmea", label: "FMEA", path: "/risk", icon: ShieldAlert },
      { key: "risk-dashboard", label: "Risk dashboard", path: "/risk/dashboard", icon: BarChart3 },
      doc("ecn", GitBranch),
      doc("ecr", GitBranch),
      { key: "process-change", label: "Process Change", path: "/change", icon: GitBranch },
      doc("work-instructions", ScrollText),
      { key: "master-document-list-eng", label: "Master Document List", path: "/documents/master-list", icon: FileText },
      { key: "master-equipment-list-eng", label: "Master Equipment List", path: "/calibration/master-list", icon: Gauge },
      { key: "cross-training-eng", label: "Cross-Training Evaluation", path: "/iso-forms/frm-trn-002", icon: GraduationCap },
    ],
  },
  {
    key: "quality",
    label: "Quality",
    icon: ShieldCheck,
    children: [
      {
        key: "document-control",
        label: "Document Control",
        icon: FileText,
        path: "/documents",
        children: [
          { key: "folder-explorer", label: "Folder Explorer", path: "/documents/folders", icon: FolderTree },
          { key: "master-document-list", label: "Master Document List", path: "/documents/master-list", icon: FileText },
          { key: "dcr", label: "Document changes", path: "/document-change-requests", icon: FileEdit },
          { key: "qms-forms", label: "QMS Forms", path: "/qms-forms", icon: Library },
          { key: "management-system", label: "Management System", path: "/management-system", icon: Building2 },
        ],
      },
      doc(OBSOLETE_ARCHIVE_CATEGORY, Archive),
      { key: "training", label: "Training", path: "/training", icon: GraduationCap },
      { key: "frm-trn-001", label: "Competency Record", path: "/iso-forms/frm-trn-001", icon: GraduationCap },
      { key: "frm-trn-002", label: "Cross-Training Evaluation", path: "/iso-forms/frm-trn-002", icon: GraduationCap },
      { key: "workers", label: "Workers", path: "/workers", icon: Users },
      { key: "inspections", label: "Inspections", path: "/quality-inspection-reports", icon: ClipboardCheck },
      doc("validation-reports", FileText),
      { key: "fai", label: "FAI", path: "/iso-forms/frm-fai-001", icon: ClipboardCheck },
      doc("product-alerts", FileText),
      doc("recalls", FileText),
      { key: "warranty", label: "Warranty", path: "/warranty", icon: ShieldCheck },
      { key: "frm-qa-001", label: "Quality Alert", path: "/iso-forms/frm-qa-001", icon: AlertTriangle },
      { key: "frm-cus-001", label: "Customer Scorecard", path: "/iso-forms/frm-cus-001", icon: PieChart },
      { key: "frm-fae-001", label: "Failure Effectiveness", path: "/iso-forms/frm-fae-001", icon: BarChart3 },
      doc("repairs", Hammer),
      {
        key: "sop",
        label: "SOP",
        icon: ScrollText,
        children: [doc("sop-procedures", FileText), doc("sop-policies", FileText)],
      },
      {
        key: "calibration",
        label: "Calibration",
        icon: Gauge,
        path: "/calibration",
        children: [doc("master-tool-list", Wrench), { key: "master-equipment-list", label: "Master Equipment List", path: "/calibration/master-list", icon: Gauge }],
      },
      {
        key: "audits",
        label: "Audits",
        icon: ClipboardCheck,
        path: "/audits",
        children: [
          doc("internal-audits", ClipboardCheck),
          doc("audit-plan", ClipboardList),
          doc("audit-schedule", ClipboardList),
          doc("audit-checklist", ClipboardCheck),
          { key: "frm-gen-001", label: "Internal Audit Checklist", path: "/iso-forms/frm-gen-001", icon: ClipboardCheck },
          doc("audit-report", FileText),
        ],
      },
      {
        key: "suppliers",
        label: "Suppliers",
        icon: Truck,
        path: "/suppliers",
        children: [
          { key: "supplier_portal", label: "Supplier Portal", path: "/supplier-portal", icon: Building2 },
          { key: "scar", label: "SCAR", path: "/scar-forms", icon: ClipboardList },
        ],
      },
      {
        key: "ncr-capa",
        label: "NCR & CAPA",
        icon: AlertTriangle,
        children: [
          { key: "ncr", label: "NCR", path: "/ncr", icon: AlertTriangle },
          { key: "capa", label: "CAPA", path: "/capa", icon: ClipboardCheck },
          { key: "8d", label: "8D", path: "/8d", icon: FileSearch },
          { key: "frm-ncr-001", label: "NCR Form (FRM-NCR-001)", path: "/iso-forms/frm-ncr-001", icon: FileText },
          { key: "frm-ncr-002", label: "Quarantine Notice", path: "/iso-forms/frm-ncr-002", icon: FileText },
          { key: "frm-ncr-003", label: "Concession / Deviation", path: "/iso-forms/frm-ncr-003", icon: FileText },
        ],
      },
      { key: "quarantine", label: "Quarantined items", path: "/quarantine", icon: ShieldAlert },
    ],
  },
  {
    key: "admin-tools",
    label: "Admin & tools",
    icon: Shield,
    children: [
      { key: "workflow", label: "Workflow Builder", path: "/workflow", icon: Workflow },
      { key: "ai", label: "AI Insights", path: "/ai", icon: Sparkles },
      { key: "audit-log", label: "Audit log", path: "/audit-log", icon: ScrollText, auditLog: true },
      { key: "admin", label: "Admin", path: "/admin", icon: Shield, adminOnly: true },
    ],
  },
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
  return pathname === path || pathname.startsWith(`${path}/`);
}
