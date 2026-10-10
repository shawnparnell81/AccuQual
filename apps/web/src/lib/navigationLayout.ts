import { ClipboardList, FileText, FlaskConical } from "lucide-react";
import { ISO_FORMS } from "./isoFormCatalog";
import { isFolder, type SidebarFolder, type SidebarLink, type SidebarNode } from "../components/layout/sidebarStructure";

/**
 * Greer and Wellman share one menu. Wellman, and All sites, also carry
 * development. A single named site other than Wellman does not.
 */
export function siteShowsDevelopment(siteName: string | null | undefined, scope: "all" | null | undefined): boolean {
  if (scope === "all") return true;
  return (siteName ?? "").trim().toLowerCase() === "wellman";
}

function devLabel(title: string): string {
  return title.replace(/\s+DEVELOPMENT DOCUMENT$/i, "").replace(/\s+/g, " ").trim();
}

/** Development log, the monthly engineering report, and each FRM-DEV form. */
export function developmentMenu(): SidebarFolder {
  const forms = ISO_FORMS.filter((form) => form.formKey.startsWith("frm-dev-"));
  const monthly = ISO_FORMS.find((form) => form.formKey === "rpt-eng-001");
  const children: SidebarLink[] = [
    {
      key: "development-log",
      label: "Development Log",
      path: "/documents/development-log",
      icon: ClipboardList,
    },
  ];
  if (monthly) {
    children.push({
      key: monthly.formKey,
      label: "Monthly Engineering Report",
      path: `/iso-forms/${monthly.formKey}`,
      icon: FileText,
    });
  }
  for (const form of forms) {
    const short = devLabel(form.title);
    children.push({
      key: form.formKey,
      label: form.formId ? `${form.formId} ${short}` : short,
      path: `/iso-forms/${form.formKey}`,
      icon: FileText,
    });
  }
  return {
    key: "development",
    label: "Development",
    icon: FlaskConical,
    children,
  };
}

function withoutDevelopment(nodes: SidebarNode[]): SidebarNode[] {
  const out: SidebarNode[] = [];
  for (const node of nodes) {
    if (node.key === "development") continue;
    if (isFolder(node)) out.push({ ...node, children: withoutDevelopment(node.children) });
    else out.push(node);
  }
  return out;
}

/**
 * Wellman and All sites get Development inside Engineering.
 * A menu that has no Engineering group gets it just before Reports.
 * An empty list leaves the shared menu unchanged.
 */
export function withDevelopment(nodes: SidebarNode[], development: SidebarNode[]): SidebarNode[] {
  const rest = withoutDevelopment(nodes);
  if (development.length === 0) return rest;
  const folder = development[0]!;
  const engineering = rest.find((node) => node.key === "engineering");
  if (engineering && isFolder(engineering)) {
    return rest.map((node) => (node.key === "engineering" && isFolder(node) ? { ...node, children: [...node.children, folder] } : node));
  }
  const at = rest.findIndex((node) => node.key === "reporting");
  if (at < 0) return [...rest, folder];
  return [...rest.slice(0, at), folder, ...rest.slice(at)];
}

/**
 * A folder that itself opens a page keeps that page as the first menu row,
 * then lists its children. Nested folders stay folders.
 */
export function folderMenuEntries(node: SidebarFolder): SidebarNode[] {
  if (!node.path) return node.children;
  const page: SidebarLink = {
    key: `${node.key}__page`,
    label: node.label,
    path: node.path,
    icon: node.icon,
  };
  return [page, ...node.children];
}

/**
 * A group whose menu would contain one link is that link.
 * The row keeps the group name and opens the only destination.
 * A nested folder is left alone so a real submenu can still open.
 */
/** Quality's NCR, CAPA, and 8D stay a group even when a saved menu left one child. */
const OPEN_MENU_GROUPS = new Set(["ncr-capa"]);

export function collapseSingleItemMenus(node: SidebarNode): SidebarNode {
  if (!isFolder(node)) return node;
  const folder: SidebarFolder = { ...node, children: node.children.map(collapseSingleItemMenus) };
  if (OPEN_MENU_GROUPS.has(folder.key)) return folder;
  const entries = folderMenuEntries(folder);
  const only = entries[0];
  if (entries.length !== 1 || !only || isFolder(only)) return folder;
  return {
    key: folder.key,
    label: folder.label,
    path: only.path,
    icon: folder.icon,
    adminOnly: folder.adminOnly,
    external: only.external,
  };
}

export function menuLabels(nodes: SidebarNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    out.push(node.label);
    if (isFolder(node)) out.push(...menuLabels(node.children));
  }
  return out;
}
