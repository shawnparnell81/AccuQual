import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ClipboardCheck,
  ClipboardList,
  Cog,
  Factory,
  FileSearch,
  FileText,
  Gauge,
  GitBranch,
  Hammer,
  Package,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Ship,
  Truck,
  Wrench,
} from "lucide-react";

export interface SidebarLink {
  key: string;
  label: string;
  path: string;
  icon: LucideIcon;
}

export interface SidebarFolder {
  key: string;
  label: string;
  icon: LucideIcon;
  /** When set, the folder name itself opens this page (in addition to its children). */
  path?: string;
  children: SidebarNode[];
}

export type SidebarNode = SidebarLink | SidebarFolder;

export function isFolder(node: SidebarNode): node is SidebarFolder {
  return "children" in node;
}

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
  shipping: { title: "Shipping", blurb: "Shipping documents. Upload a file to keep it here." },
  receiving: { title: "Receiving", blurb: "Receiving documents. Upload a file to keep it here." },
  "validation-reports": { title: "Validation Reports", blurb: "Process and product validation reports. Upload a file to keep it here." },
};

function doc(key: keyof typeof DOCUMENT_FOLDER_PAGES, icon: LucideIcon): SidebarLink {
  const page = DOCUMENT_FOLDER_PAGES[key]!;
  return { key, label: page.title, path: `/folders/${key}`, icon };
}

export const SIDEBAR_FOLDERS: SidebarFolder[] = [
  {
    key: "engineering",
    label: "Engineering",
    icon: Cog,
    children: [
      doc("drawings", FileText),
      doc("apqp", ClipboardList),
      { key: "ppap", label: "PPAP Packet", path: "/ppap", icon: ClipboardList },
      { key: "fmea", label: "FMEA", path: "/risk", icon: ShieldAlert },
      doc("ecn", GitBranch),
      doc("ecr", GitBranch),
      { key: "process-change", label: "Process Change", path: "/change", icon: GitBranch },
      doc("work-instructions", ScrollText),
    ],
  },
  {
    key: "quality",
    label: "Quality",
    icon: ShieldCheck,
    children: [
      { key: "inspections", label: "Inspections", path: "/quality-inspection-reports", icon: ClipboardCheck },
      doc("validation-reports", FileText),
      { key: "fai", label: "FAI", path: "/qms-forms/first_article_inspection", icon: ClipboardCheck },
      { key: "warranty", label: "Warranty", path: "/warranty", icon: ShieldCheck },
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
        children: [doc("master-tool-list", Wrench)],
      },
      {
        key: "audit",
        label: "Audit",
        icon: ClipboardCheck,
        children: [doc("audit-plan", ClipboardList), doc("audit-schedule", ClipboardList), doc("audit-checklist", ClipboardCheck), doc("audit-report", FileText)],
      },
      {
        key: "issues",
        label: "Issues",
        icon: AlertTriangle,
        children: [
          { key: "8d", label: "8D", path: "/8d", icon: FileSearch },
          { key: "ncr", label: "NCR", path: "/ncr", icon: AlertTriangle },
          { key: "capa", label: "CAPA", path: "/capa", icon: ClipboardCheck },
        ],
      },
      { key: "quarantine", label: "Quarantined items", path: "/quarantine", icon: ShieldAlert },
    ],
  },
  {
    key: "operations",
    label: "Operations",
    icon: Factory,
    children: [
      doc("shipping", Ship),
      doc("receiving", Truck),
      {
        key: "production",
        label: "Production",
        icon: Package,
        path: "/production-logs",
        children: [{ key: "work-orders", label: "Work Orders", path: "/work-orders", icon: ClipboardList }],
      },
    ],
  },
];

export function flattenSidebarLinks(nodes: SidebarNode[] = SIDEBAR_FOLDERS): SidebarLink[] {
  const out: SidebarLink[] = [];
  for (const node of nodes) {
    if (isFolder(node)) {
      if (node.path) out.push({ key: node.key, label: node.label, path: node.path, icon: node.icon });
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
