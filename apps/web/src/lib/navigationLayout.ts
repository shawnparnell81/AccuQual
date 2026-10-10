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

/** Inserts Development just before Reports. An empty list leaves the shared menu unchanged. */
export function withDevelopment(nodes: SidebarNode[], development: SidebarNode[]): SidebarNode[] {
  const rest = nodes.filter((node) => node.key !== "development");
  if (development.length === 0) return rest;
  const folder = development[0]!;
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

export function menuLabels(nodes: SidebarNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    out.push(node.label);
    if (isFolder(node)) out.push(...menuLabels(node.children));
  }
  return out;
}
