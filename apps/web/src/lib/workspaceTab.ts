import {
  isExternalHref,
  isFolder,
  pathMatches,
  PERMANENT_SIDEBAR_LINKS,
  SIDEBAR_FOLDERS,
  type SidebarNode,
} from "../components/layout/sidebarStructure";
import { developmentMenu, withDevelopment } from "./navigationLayout";
import { normalizeTabPath, registerSectionTabPaths } from "./tabPaths";

/**
 * One workspace tab per nav section that has sub-pages (Admin, Settings,
 * Reports, Quality, Engineering, Documents, and every other folder in the
 * sidebar that works the same way). The section is the top-level folder, or
 * a permanent footer link such as Settings. Which path belongs where comes
 * from that nav config: the longest matching link wins, and a section that
 * has its own path also keeps unlisted routes under that path (for example
 * /admin/company-branding). The app root stays the Dashboard tab.
 */

export interface WorkspaceSectionLink {
  path: string;
  label: string;
}

export interface WorkspaceSection {
  id: string;
  label: string;
  /** Set when the section itself opens a page. Routes under it stay on this tab. */
  root: string | null;
  links: WorkspaceSectionLink[];
}

const SECTION_ICONS: Record<string, string> = {
  home: "dashboard",
  "document-control": "documents",
  quality: "quality",
  engineering: "default",
  equipment: "calibration",
  suppliers: "supplier",
  reporting: "default",
  admin: "admin",
  settings: "settings",
};

/** First URL segment words that are abbreviations, so a route slug stays readable. */
const SLUG_ACRONYMS = new Set(["ai", "api", "apqp", "capa", "crar", "ecn", "ecr", "erp", "fai", "ncr", "ppap", "qms", "rma", "scar", "sop", "sso"]);

export interface WorkspaceTabFields {
  id: string;
  path: string;
  title: string;
  icon: string;
  pinned?: boolean;
}

function rememberLink(links: WorkspaceSectionLink[], path: string | undefined, label: string) {
  if (!path || path === "/" || isExternalHref(path)) return;
  if (links.some((link) => link.path === path)) return;
  links.push({ path, label });
}

function collectLinks(node: SidebarNode, links: WorkspaceSectionLink[]) {
  if (isFolder(node)) {
    rememberLink(links, node.path, node.label);
    for (const child of node.children) collectLinks(child, links);
    return;
  }
  rememberLink(links, node.path, node.label);
}

function buildWorkspaceSections(): WorkspaceSection[] {
  const sections: WorkspaceSection[] = [];
  const menu = withDevelopment(SIDEBAR_FOLDERS, [developmentMenu()]);
  for (const node of menu) {
    if (!isFolder(node)) continue;
    const links: WorkspaceSectionLink[] = [];
    collectLinks(node, links);
    if (!links.some((link) => link.path !== node.path)) continue;
    sections.push({ id: node.key, label: node.label, root: node.path && node.path !== "/" ? node.path : null, links });
  }
  for (const link of PERMANENT_SIDEBAR_LINKS) {
    if (!link.path || link.path === "/" || isExternalHref(link.path)) continue;
    sections.push({
      id: link.key,
      label: link.label,
      root: link.path,
      links: [{ path: link.path, label: link.label }],
    });
  }
  return sections;
}

let cachedSections: WorkspaceSection[] | null = null;

/** Every nav section whose sub-pages share one workspace tab. */
export function workspaceSections(): WorkspaceSection[] {
  if (!cachedSections) cachedSections = buildWorkspaceSections();
  return cachedSections;
}

interface SectionMatch {
  section: WorkspaceSection;
  path: string;
  label: string;
  /** True when the match is the section's own path, not a named sub-page. */
  root: boolean;
}

function bestMatch(pathname: string): SectionMatch | null {
  let best: SectionMatch | null = null;
  for (const section of workspaceSections()) {
    for (const link of section.links) {
      if (!pathMatches(pathname, link.path)) continue;
      const root = section.root != null && link.path === section.root;
      const longer = best != null && link.path.length > best.path.length;
      const sameLengthPrefersNamedPage = best != null && link.path.length === best.path.length && !root && best.root;
      if (!best || longer || sameLengthPrefersNamedPage) {
        best = { section, path: link.path, label: link.label, root };
      }
    }
  }
  return best;
}

function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => (SLUG_ACRONYMS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

export function workspaceSectionId(path: string): string | null {
  return bestMatch(normalizeTabPath(path))?.section.id ?? null;
}

registerSectionTabPaths((pathname) => workspaceSectionId(pathname) != null);

/** Identity of the workspace tab this path belongs to. Sub-pages of one section share it. */
export function workspaceTabKey(path: string): string {
  const pathname = normalizeTabPath(path);
  const section = workspaceSectionId(pathname);
  return section ? `section:${section}` : pathname;
}

export function workspaceSectionIcon(path: string): string | null {
  const match = bestMatch(normalizeTabPath(path));
  if (!match) return null;
  return SECTION_ICONS[match.section.id] ?? "default";
}

/** Title for a shared section, including the sub-page when the nav names it. */
export function workspaceSectionTitle(path: string): string | null {
  const pathname = normalizeTabPath(path);
  const match = bestMatch(pathname);
  if (!match) return null;
  if (match.root && pathname === match.section.root) return match.section.label;
  if (!match.root) return `${match.section.label} · ${match.label}`;
  const slug = match.section.root ? pathname.slice(match.section.root.length).split("/").filter(Boolean)[0] : undefined;
  if (!slug || /^\d+$/.test(slug)) return match.section.label;
  const label = humanizeSlug(slug);
  return label ? `${match.section.label} · ${label}` : match.section.label;
}

/**
 * Collapse saved tabs that are the same section. The active sub-page wins.
 * A pin on any copy stays on the tab that remains.
 */
export function dedupeWorkspaceTabs<T extends { id: string; path: string; pinned?: boolean }>(
  tabs: T[],
  activeId: string | null,
): { tabs: T[]; activeId: string | null } {
  const indexByKey = new Map<string, number>();
  const next: T[] = [];
  for (const tab of tabs) {
    if (typeof tab?.path !== "string" || typeof tab.id !== "string") continue;
    const key = workspaceTabKey(tab.path);
    const at = indexByKey.get(key);
    if (at == null) {
      indexByKey.set(key, next.length);
      next.push(tab);
      continue;
    }
    const current = next[at]!;
    const pinned = Boolean(current.pinned || tab.pinned);
    next[at] = tab.id === activeId ? { ...tab, pinned } : { ...current, pinned };
  }
  if (next.some((tab) => tab.id === activeId)) return { tabs: next, activeId };
  const dropped = tabs.find((tab) => tab.id === activeId);
  const survivor = dropped ? next.find((tab) => workspaceTabKey(tab.path) === workspaceTabKey(dropped.path)) : undefined;
  return { tabs: next, activeId: survivor?.id ?? next[0]?.id ?? null };
}

/**
 * Move the workspace onto `next`. A sub-page of the active section rewrites
 * that tab. A different section focuses its existing tab, or opens one.
 */
export function followWorkspacePath<T extends WorkspaceTabFields>(
  tabs: T[],
  activeId: string | null,
  next: { path: string; title: string; icon: string },
  createId: () => string,
): { tabs: T[]; activeId: string } {
  const key = workspaceTabKey(next.path);
  const active = tabs.find((tab) => tab.id === activeId) ?? null;

  function rewritten(tab: T): T {
    return { ...tab, path: next.path, title: next.title, icon: next.icon };
  }

  if (active && workspaceTabKey(active.path) === key) {
    if (active.path === next.path && active.title === next.title && active.icon === next.icon) {
      return { tabs, activeId: active.id };
    }
    return { tabs: tabs.map((tab) => (tab.id === active.id ? rewritten(tab) : tab)), activeId: active.id };
  }

  const existing = tabs.find((tab) => workspaceTabKey(tab.path) === key);
  if (existing) {
    const same = existing.path === next.path && existing.title === next.title && existing.icon === next.icon;
    return {
      tabs: same ? tabs : tabs.map((tab) => (tab.id === existing.id ? rewritten(tab) : tab)),
      activeId: existing.id,
    };
  }

  const created = { id: createId(), path: next.path, title: next.title, icon: next.icon } as T;
  return { tabs: [...tabs, created], activeId: created.id };
}
