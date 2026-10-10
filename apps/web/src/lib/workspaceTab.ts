import { normalizeTabPath } from "./tabPaths";

/**
 * A section whose own strip (Admin, Settings, and the same kind of in-page
 * tabs) changes the URL without being a new workspace page. Those paths
 * share one workspace tab. A record, a list, and a different module stay
 * separate tabs.
 */
const SECTION_PREFIXES = [
  { id: "admin", prefix: "/admin" },
  { id: "settings", prefix: "/settings" },
] as const;

const ADMIN_PAGES: Record<string, string> = {
  users: "Users & Roles",
  import: "Import data",
  plants: "Plants",
  "roles-permissions": "Permissions",
  "login-history": "Login History",
  "ai-settings": "AI Settings",
  "supplier-settings": "Supplier Settings",
  "quality-settings": "Quality Settings",
  "receiving-inventory-settings": "Receiving & Inventory",
  "system-health": "System Health",
  "api-docs": "API Reference",
  sso: "Single Sign-On",
  "data-export": "Data Export",
  "company-settings": "Company Settings",
  "company-branding": "Branding",
  "company-templates": "Templates",
  "digital-twin": "Digital Twin",
  "company-ai": "Company AI",
  "ai-usage": "AI Usage",
};

export interface WorkspaceTabFields {
  id: string;
  path: string;
  title: string;
  icon: string;
  pinned?: boolean;
}

export function workspaceSectionId(path: string): string | null {
  const pathname = normalizeTabPath(path);
  for (const section of SECTION_PREFIXES) {
    if (pathname === section.prefix || pathname.startsWith(`${section.prefix}/`)) return section.id;
  }
  return null;
}

/** Identity of the workspace tab this path belongs to. Sub-pages of one section share it. */
export function workspaceTabKey(path: string): string {
  const pathname = normalizeTabPath(path);
  const section = workspaceSectionId(pathname);
  return section ? `section:${section}` : pathname;
}

/** Title for a shared section, including the sub-page when it has a name. */
export function workspaceSectionTitle(path: string): string | null {
  const pathname = normalizeTabPath(path);
  const section = workspaceSectionId(pathname);
  if (section === "admin") {
    if (pathname === "/admin") return "Admin";
    const slug = pathname.slice("/admin/".length).split("/")[0] ?? "";
    const label = ADMIN_PAGES[slug];
    return label ? `Admin · ${label}` : "Admin";
  }
  if (section === "settings") {
    if (pathname === "/settings") return "Settings";
    if (pathname.startsWith("/settings/navigation")) return "Settings · Navigation";
    if (pathname.startsWith("/settings/erp")) return "Settings · ERP / NetSuite";
    return "Settings";
  }
  return null;
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
