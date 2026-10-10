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

function ownsPath(section: WorkspaceSection, pathname: string): boolean {
  if (!section.root) return false;
  return pathname === section.root || pathname.startsWith(`${section.root}/`);
}

/** Longer link wins. A tie stays with the section whose own URL contains the page, so a shortcut in another menu does not steal it. */
function prefers(pathname: string, candidate: SectionMatch, best: SectionMatch): boolean {
  if (candidate.path.length !== best.path.length) return candidate.path.length > best.path.length;
  const candidateOwns = ownsPath(candidate.section, pathname);
  const bestOwns = ownsPath(best.section, pathname);
  if (candidateOwns !== bestOwns) return candidateOwns;
  return !candidate.root && best.root;
}

function bestMatch(pathname: string): SectionMatch | null {
  let best: SectionMatch | null = null;
  for (const section of workspaceSections()) {
    for (const link of section.links) {
      if (!pathMatches(pathname, link.path)) continue;
      const root = section.root != null && link.path === section.root;
      const candidate: SectionMatch = { section, path: link.path, label: link.label, root };
      if (!best || prefers(pathname, candidate, best)) best = candidate;
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
    if (keepsFilteredPath(active.path, next.path)) return { tabs, activeId: active.id };
    if (active.path === next.path && active.title === next.title && active.icon === next.icon) {
      return { tabs, activeId: active.id };
    }
    return { tabs: tabs.map((tab) => (tab.id === active.id ? rewritten(tab) : tab)), activeId: active.id };
  }

  const existing = tabs.find((tab) => workspaceTabKey(tab.path) === key);
  if (existing) {
    if (keepsFilteredPath(existing.path, next.path)) return { tabs, activeId: existing.id };
    const same = existing.path === next.path && existing.title === next.title && existing.icon === next.icon;
    return {
      tabs: same ? tabs : tabs.map((tab) => (tab.id === existing.id ? rewritten(tab) : tab)),
      activeId: existing.id,
    };
  }

  const created = { id: createId(), path: next.path, title: next.title, icon: next.icon } as T;
  return { tabs: [...tabs, created], activeId: created.id };
}

/** The router reports a pathname when a list tab is filtered. Keep that query. */
function keepsFilteredPath(current: string, incoming: string): boolean {
  if (incoming.includes("?") || incoming.includes("#")) return false;
  const bare = current.split("?")[0]?.split("#")[0] ?? "";
  return bare === incoming && current.startsWith(`${incoming}?`);
}

const SUPPRESSED_LIMIT = 40;

/** A click that is not the tab's close control. Route sync may reopen a closed section only after one of these. */
let tabUserGesture = false;

export function noteTabUserGesture(): void {
  tabUserGesture = true;
}

export function peekTabUserGesture(): boolean {
  return tabUserGesture;
}

export function consumeTabUserGesture(): boolean {
  const value = tabUserGesture;
  tabUserGesture = false;
  return value;
}

export function resetTabUserGesture(): void {
  tabUserGesture = false;
}

/** Closed section keys (or a lone page) that the address bar must not recreate. */
export function uniqueSuppressed(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const key of keys) {
    if (typeof key !== "string" || key === "") continue;
    const normalized = key.startsWith("section:") ? key : workspaceTabKey(key);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    next.push(normalized);
  }
  const limited = next.slice(-SUPPRESSED_LIMIT);
  if (limited.length === keys.length && limited.every((key, index) => key === keys[index])) return keys as string[];
  return limited;
}

export function rememberSuppressed(keys: readonly string[], path: string): string[] {
  return uniqueSuppressed([...keys, workspaceTabKey(path)]);
}

export function forgetSuppressed(keys: readonly string[], path: string): string[] {
  const key = workspaceTabKey(path);
  if (!keys.includes(key)) return keys as string[];
  return keys.filter((entry) => entry !== key);
}

export function dropSuppressedTabs<T extends { id: string; path: string }>(
  tabs: T[],
  activeId: string | null,
  suppressed: readonly string[],
): { tabs: T[]; activeId: string | null } {
  const blocked = new Set(suppressed);
  const kept = tabs.filter((tab) => typeof tab?.path === "string" && !blocked.has(workspaceTabKey(tab.path)));
  const active = kept.some((tab) => tab.id === activeId) ? activeId : (kept[0]?.id ?? null);
  return { tabs: kept, activeId: active };
}

/**
 * Remove one workspace tab. The neighbor becomes active when the closed tab
 * was showing, and its section stays closed until the user opens it again.
 */
export function closeWorkspaceTab<T extends { id: string; path: string }>(
  tabs: T[],
  activeId: string | null,
  suppressed: readonly string[],
  id: string,
): { tabs: T[]; activeId: string | null; suppressed: string[]; navigateTo: string | null } {
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index < 0) {
    const current = tabs.find((tab) => tab.id === activeId);
    return { tabs, activeId, suppressed: uniqueSuppressed(suppressed), navigateTo: current?.path ?? null };
  }
  const closed = tabs[index]!;
  const nextTabs = tabs.filter((tab) => tab.id !== id);
  let nextActive = activeId;
  let navigateTo: string | null = null;
  if (activeId === id) {
    const neighbor = nextTabs[index - 1] ?? nextTabs[index] ?? null;
    nextActive = neighbor?.id ?? null;
    navigateTo = neighbor?.path ?? null;
  }
  return {
    tabs: nextTabs,
    activeId: nextActive,
    suppressed: rememberSuppressed(suppressed, closed.path),
    navigateTo,
  };
}

/**
 * Apply the address bar. A closed section is not recreated, and `redirectTo`
 * is the neighbor the strip is actually showing. `reopen` is an explicit
 * visit (a click, or Open in a new tab).
 */
export function syncClosedWorkspace<T extends WorkspaceTabFields>(
  tabs: T[],
  activeId: string | null,
  suppressed: readonly string[],
  next: { path: string; title: string; icon: string },
  createId: () => string,
  reopen: boolean,
): { tabs: T[]; activeId: string | null; suppressed: string[]; redirectTo: string | null } {
  const key = workspaceTabKey(next.path);
  const open = tabs.some((tab) => workspaceTabKey(tab.path) === key);
  if (suppressed.includes(key) && !reopen && !open) {
    const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0] ?? null;
    const redirectTo = active && workspaceTabKey(active.path) !== key ? active.path : null;
    return { tabs, activeId, suppressed: uniqueSuppressed(suppressed), redirectTo };
  }
  const followed = followWorkspacePath(tabs, activeId, next, createId);
  const nextSuppressed = forgetSuppressed(suppressed, next.path);
  return { tabs: followed.tabs, activeId: followed.activeId, suppressed: nextSuppressed, redirectTo: null };
}
