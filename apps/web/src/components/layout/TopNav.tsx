import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Box, Building2, ChevronDown, Grid2x2, Library, Lock, Menu, Search, Settings, Sparkles, X, type LucideIcon } from "lucide-react";
import { useWindowStore } from "../../window-manager/useWindowStore";
import { apiClient } from "../../api/client";
import { useCurrentTenant, useCurrentUser } from "../../hooks/useAuth";
import { HomeButton } from "./HomeButton";
import { CalendarButton } from "./CalendarButton";
import { BackButton } from "./BackButton";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { extraGrantedLeaves, useNavVisibility } from "./navVisibility";
import { useDepartmentPermissionsGrid } from "../../hooks/useDepartmentPermissionsGrid";
import { GlobalSearchResults } from "./GlobalSearchResults";
import {
  DASHBOARD_LEAF,
  DEPARTMENTS,
  KPI_COUNT_KEYS,
  PLATFORM_LEAF,
  SYSTEM_LABEL,
  type AccessLevel,
  type Department,
  type DepartmentMeta,
  type NavLeaf,
} from "./navConfig";

type KpiCounts = Partial<Record<(typeof KPI_COUNT_KEYS)[number], number>>;
type DropdownId = Department | "system" | "library" | "modules";

// How long the cursor may be off a dropdown (moving from the trigger down into
// the panel briefly leaves both) before it auto-closes. Long enough that the
// hand-off doesn't flicker, short enough that it still feels like "closes when
// you move off it".
const CLOSE_GRACE_MS = 150;

/**
 * Phase 1 System-menu cleanup: groups the flat "System" catch-all into three
 * labeled sections instead of one undifferentiated list mixing day-to-day
 * tools with admin config — see navConfig.ts's own `section` tag on each
 * leaf. Order matters here: the everyday tools a quality-team user actually
 * opens daily come first, admin configuration second, and "advanced" last —
 * which in practice is usually empty/hidden entirely, since those three
 * items are hidden by default for every tenant (see
 * db/defaultNavPreferences.ts) unless an admin has explicitly turned one
 * back on from Settings > Navigation.
 */
const SYSTEM_SECTIONS: { key: "quality" | "admin" | "advanced"; label: string }[] = [
  { key: "quality", label: "Quality & Compliance" },
  { key: "admin", label: "Admin" },
  { key: "advanced", label: "Advanced" },
];

function useKpiCounts() {
  const { data } = useQuery({
    queryKey: ["nav-kpi-counts"],
    queryFn: async () => (await apiClient.get<KpiCounts>("/nav/kpi-counts")).data,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return data ?? {};
}

interface DocumentFolderNode {
  id: number;
  name: string;
  parentId: number | null;
}

const LIBRARY_POOL_NAME = "Library Pool";

/**
 * The Document Library dropdown mirrors whatever the user has saved in the
 * Folder Explorer (/documents/folders) — same query key, so a save there
 * invalidates this too. Only top-level nodes (departments) show up here;
 * the Library Pool is a Folder Explorer concept, not a nav destination.
 */
function useDocumentLibraryTopLevel() {
  const { data = [] } = useQuery({
    queryKey: ["document-folders"],
    queryFn: async () => (await apiClient.get<DocumentFolderNode[]>("/document-folders")).data,
    staleTime: 30_000,
  });
  return data.filter((f) => f.parentId === null && f.name !== LIBRARY_POOL_NAME);
}

/**
 * Read/write access this viewer has on a leaf, given which dropdown it's
 * being shown in. `liveLevel` — this viewer's own real-time
 * GET /permissions/effective value for this leaf's key — wins when
 * available; navConfig.ts's static `access` map is only the fallback (used
 * before that query resolves). Admin/platform_admin bypass unconditionally
 * (matches getUserAccessLevel's own admin short-circuit in
 * departmentAccess.ts) — NOT gated on the static access map, since that
 * would hide any live-granted "extra" leaf a department's own array never
 * listed (see extraGrantedLeaves below).
 */
function effectiveAccess(leaf: NavLeaf, department: Department, bypass: boolean, liveLevel?: AccessLevel): AccessLevel {
  if (bypass) return "edit";
  if (liveLevel !== undefined) return liveLevel;
  return leaf.access[department] ?? "none";
}

// extraGrantedLeaves moved to navVisibility.ts (imported above) so
// CommandPalette.tsx can compute the exact same "what's live-granted"
// result without a second copy of this logic.

export function TopNav() {
  const tenant = useCurrentTenant();
  const user = useCurrentUser();
  const isPlatformAdmin = user?.roleName === "platform_admin";
  const isAdmin = user?.roleName === "admin";
  const userDept = user?.department as Department | null | undefined;
  const { effective: myEffective } = useEffectivePermissions();
  const departmentPermissionsGrid = useDepartmentPermissionsGrid(isAdmin);
  const kpiCounts = useKpiCounts();
  const documentLibrary = useDocumentLibraryTopLevel();
  const openWindow = useWindowStore((s) => s.openWindow);

  const [openId, setOpenId] = useState<DropdownId | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState<DropdownId | null>(null);
  const [query, setQuery] = useState("");
  const navRef = useRef<HTMLElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelClose() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }
  function scheduleClose(id: DropdownId) {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      setOpenId((current) => (current === id ? null : current));
    }, CLOSE_GRACE_MS);
  }
  function openNow(id: DropdownId) {
    cancelClose();
    setOpenId(id);
  }

  useEffect(() => {
    // Fallback for touch/keyboard flows that never fire mouseleave: still
    // close on a click elsewhere or Escape.
    function onClickAway(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenId(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenId(null);
    }
    document.addEventListener("mousedown", onClickAway);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickAway);
      document.removeEventListener("keydown", onKey);
      cancelClose();
    };
  }, []);

  // visibleGroups/allVisibleLeaves: which department dropdowns this viewer
  // gets at all (admin/own-department + the tenant's own hidden-nav
  // customization) and the flat, live-granted-inclusive leaf list derived
  // from them — moved to navVisibility.ts so CommandPalette.tsx computes
  // the exact same "what can this viewer see right now" result.
  const { visibleGroups, allVisibleLeaves } = useNavVisibility();

  const systemGroup = visibleGroups.find((g) => g.department === null);
  const departmentGroups = visibleGroups.filter((g) => g.department !== null);

  const searchResults = query.trim()
    ? allVisibleLeaves.filter((l) => l.label.toLowerCase().includes(query.trim().toLowerCase()))
    : [];

  if (isPlatformAdmin) {
    return (
      <header className="border-b border-border bg-card">
        <div className="h-14 flex items-center gap-4 px-4">
          <BrandMark tenant={tenant} />
          <NavLink
            to={PLATFORM_LEAF.path}
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm",
                isActive ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted"
              )
            }
          >
            <Building2 size={18} />
            <span>Platform Admin</span>
          </NavLink>
        </div>
      </header>
    );
  }

  return (
    <header className="border-b border-border bg-card relative" ref={navRef}>
      <div className="min-h-14 flex flex-wrap items-center gap-y-1 gap-x-3 px-4 py-2">
        <BrandMark tenant={tenant} />

        {/* Desktop mega-menu — wraps onto a second line rather than clipping
            or overlapping the search box when the window is too narrow for
            every department to fit on one row. */}
        <nav className="hidden md:flex flex-1 flex-wrap items-center gap-1 min-w-0">
          <BackButton />
          <HomeButton />
          <CalendarButton />
          <ModulesDropdown
            leaves={allVisibleLeaves}
            isOpen={openId === "modules"}
            onOpen={() => openNow("modules")}
            onScheduleClose={() => scheduleClose("modules")}
            onCancelClose={cancelClose}
            onNavigate={() => setOpenId(null)}
          />
          <NavLink
            to={DASHBOARD_LEAF.path}
            end
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap",
                isActive ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted"
              )
            }
          >
            <DASHBOARD_LEAF.icon size={18} />
            <span>{DASHBOARD_LEAF.label}</span>
          </NavLink>

          {departmentGroups.map((group) => {
            const meta = DEPARTMENTS.find((d) => d.key === group.department)!;
            const isOwnDept = group.department === userDept;
            const extra = extraGrantedLeaves(group, isOwnDept, myEffective, departmentPermissionsGrid);
            const items = [...group.items, ...extra].sort((a, b) => a.priority - b.priority);
            return (
              <NavDropdown
                key={group.department}
                id={group.department!}
                label={meta.label}
                meta={meta}
                twoColumn={items.length > 5}
                isOpen={openId === group.department}
                onOpen={() => openNow(group.department!)}
                onScheduleClose={() => scheduleClose(group.department!)}
                onCancelClose={cancelClose}
              >
                {items.map((item) => (
                  <NavItemRow
                    key={item.key}
                    item={item}
                    department={group.department!}
                    bypass={isAdmin}
                    liveLevel={isOwnDept ? myEffective?.[item.key] : departmentPermissionsGrid.get(group.department!)?.get(item.key)}
                    kpiCounts={kpiCounts}
                    onNavigate={() => setOpenId(null)}
                  />
                ))}
              </NavDropdown>
            );
          })}

          {systemGroup && (
            <NavDropdown
              id="system"
              label={SYSTEM_LABEL}
              twoColumn
              isOpen={openId === "system"}
              onOpen={() => openNow("system")}
              onScheduleClose={() => scheduleClose("system")}
              onCancelClose={cancelClose}
            >
              {SYSTEM_SECTIONS.map(({ key, label }) => ({ key, label, items: systemGroup.items.filter((item) => (item.section ?? "quality") === key) }))
                .filter((section) => section.items.length > 0)
                .map(({ key, label, items }, index) => (
                  // display:contents so this wrapper doesn't itself become a
                  // grid cell (which would break the parent's grid-cols-2
                  // layout) — its children join the grid directly instead,
                  // letting the section header span both columns. Margin is
                  // keyed off `index` (not a first-child selector) since
                  // every section header is already the DOM-first child of
                  // its own `contents` wrapper — :first-child would match
                  // every section's header, not just the topmost one.
                  <div key={key} className="contents">
                    <div className={clsx("col-span-2 px-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70", index === 0 ? "mt-0" : "mt-2")}>{label}</div>
                    {items.map((item) => (
                      <Link
                        key={item.key}
                        to={item.path}
                        title={item.notes ? `${item.label} — ${item.notes}` : item.label}
                        onClick={() => setOpenId(null)}
                        className="flex min-w-0 items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
                      >
                        <item.icon size={16} className="shrink-0" />
                        <span className="min-w-0 truncate">{item.label}</span>
                      </Link>
                    ))}
                  </div>
                ))}
            </NavDropdown>
          )}

          {documentLibrary.length > 0 && (
            <NavDropdown
              id="library"
              label="Document Library"
              // Single column, deliberately — department names here are
              // user-renamed free text (see Folder Explorer) and can run
              // long ("Shipping & Receiving"); a 2-column grid's tracks
              // don't reserve room for that and it overflowed into a
              // scrollbar instead of wrapping.
              isOpen={openId === "library"}
              onOpen={() => openNow("library")}
              onScheduleClose={() => scheduleClose("library")}
              onCancelClose={cancelClose}
            >
              {documentLibrary.map((dept) => (
                <Link
                  key={dept.id}
                  to={`/documents/folders?dept=${dept.id}`}
                  title={`Open the ${dept.name} folder in the Document Library`}
                  onClick={() => setOpenId(null)}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted whitespace-nowrap"
                >
                  <Library size={16} />
                  <span>{dept.name}</span>
                </Link>
              ))}
            </NavDropdown>
          )}
        </nav>

        {/* Quick-nav search — client-side filter over the modules above, plus
            the real GET /search results (GlobalSearchResults) for NCR#/CAPA#/
            PO#/Audit#/Supplier#/Item#/Training#/Calibration# in the same
            dropdown. Record results open in an internal tab (useOpenTab);
            module links keep navigating in place as they always have. */}
        <div className="relative hidden md:block w-52 shrink-0">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a module…"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
          {query.trim() && (
            <div className="absolute right-0 top-full z-30 mt-1 w-72 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-card p-1 shadow-lg">
              {searchResults.map((r) => (
                <Link
                  key={r.key}
                  to={r.path}
                  onClick={() => setQuery("")}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
                >
                  <r.icon size={16} />
                  <span>{r.label}</span>
                </Link>
              ))}
              <GlobalSearchResults query={query} onSelect={() => setQuery("")} />
            </div>
          )}
        </div>

        {/* Quick-view launchers: pop AI Insights / Digital Twin open as a floating window without leaving whatever page you're on — see WindowManager.tsx (Full-System Audit finding M9). */}
        <button
          type="button"
          onClick={() => openWindow({ type: "ai", title: "AI Insights" })}
          className="hidden md:flex shrink-0 p-2 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Quick AI Insights"
          title="Quick AI Insights"
        >
          <Sparkles size={18} />
        </button>
        <button
          type="button"
          onClick={() => openWindow({ type: "digitalTwin", title: "Digital Twin" })}
          className="hidden md:flex shrink-0 p-2 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Quick Digital Twin"
          title="Quick Digital Twin"
        >
          <Box size={18} />
        </button>

        {/* General app settings — nav customization is now one tab inside it, not this button's whole purpose. */}
        <Link
          to="/settings"
          className="hidden md:flex shrink-0 p-2 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Settings"
          title="Settings"
        >
          <Settings size={18} />
        </Link>

        {/* Mobile hamburger */}
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="md:hidden ml-auto p-2 rounded-md hover:bg-muted"
          aria-label="Toggle navigation menu"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile accordion */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-card px-4 py-3 flex flex-col gap-1 max-h-[calc(100vh-3.5rem)] overflow-y-auto">
          <div className="relative mb-2">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a module…"
              className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          {query.trim() ? (
            <>
              {searchResults.map((r) => (
                <Link
                  key={r.key}
                  to={r.path}
                  onClick={() => {
                    setQuery("");
                    setMobileOpen(false);
                  }}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
                >
                  <r.icon size={16} />
                  <span>{r.label}</span>
                </Link>
              ))}
              <GlobalSearchResults
                query={query}
                onSelect={() => {
                  setQuery("");
                  setMobileOpen(false);
                }}
              />
            </>
          ) : (
            <>
              <HomeButton onNavigate={() => setMobileOpen(false)} />
              <CalendarButton onNavigate={() => setMobileOpen(false)} />
              {(() => {
                const expanded = mobileExpanded === "modules";
                const byKey = new Map(allVisibleLeaves.map((l) => [l.key, l]));
                const items = MODULES_DROPDOWN_KEYS.map((key) => byKey.get(key)).filter((l): l is NavLeaf => l != null);
                return (
                  <div>
                    <button
                      type="button"
                      onClick={() => setMobileExpanded(expanded ? null : "modules")}
                      className={clsx(
                        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
                        expanded ? "bg-muted text-foreground" : "text-foreground hover:bg-muted"
                      )}
                    >
                      <Grid2x2 size={18} />
                      <span className="flex-1 text-left">Modules</span>
                      <ChevronDown size={14} className={clsx("transition-transform", expanded && "rotate-180")} />
                    </button>
                    {expanded && (
                      <div className="ml-4 flex flex-col gap-0.5 border-l border-border pl-3 py-1">
                        {items.length === 0 ? (
                          <p className="px-2 py-1 text-xs text-muted-foreground">No modules available.</p>
                        ) : (
                          items.map((item) => (
                            <Link
                              key={item.key}
                              to={item.path}
                              onClick={() => setMobileOpen(false)}
                              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              <item.icon size={16} />
                              <span>{item.label}</span>
                            </Link>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
              <Link
                to={DASHBOARD_LEAF.path}
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
              >
                <DASHBOARD_LEAF.icon size={18} />
                <span>{DASHBOARD_LEAF.label}</span>
              </Link>

              {departmentGroups.map((group) => {
                const meta = DEPARTMENTS.find((d) => d.key === group.department)!;
                const expanded = mobileExpanded === group.department;
                const isOwnDept = group.department === userDept;
                const extra = extraGrantedLeaves(group, isOwnDept, myEffective, departmentPermissionsGrid);
                const items = [...group.items, ...extra].sort((a, b) => a.priority - b.priority);
                return (
                  <div key={group.department}>
                    <button
                      type="button"
                      onClick={() => setMobileExpanded(expanded ? null : group.department!)}
                      className={clsx(
                        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
                        expanded ? clsx(meta.bgSoft, meta.text) : "text-foreground hover:bg-muted"
                      )}
                    >
                      <meta.icon size={18} className={meta.text} />
                      <span className="flex-1 text-left">{meta.label}</span>
                      <ChevronDown size={14} className={clsx("transition-transform", expanded && "rotate-180")} />
                    </button>
                    {expanded && (
                      <div className="ml-4 flex flex-col gap-0.5 border-l border-border pl-3 py-1">
                        {items.map((item) => (
                          <NavItemRow
                            key={item.key}
                            item={item}
                            department={group.department!}
                            bypass={isAdmin}
                            liveLevel={isOwnDept ? myEffective?.[item.key] : departmentPermissionsGrid.get(group.department!)?.get(item.key)}
                            kpiCounts={kpiCounts}
                            onNavigate={() => setMobileOpen(false)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {systemGroup && (
                <div>
                  <button
                    type="button"
                    onClick={() => setMobileExpanded(mobileExpanded === "system" ? null : "system")}
                    className={clsx(
                      "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
                      mobileExpanded === "system" ? "bg-muted" : "text-foreground hover:bg-muted"
                    )}
                  >
                    <span className="flex-1 text-left">{SYSTEM_LABEL}</span>
                    <ChevronDown size={14} className={clsx("transition-transform", mobileExpanded === "system" && "rotate-180")} />
                  </button>
                  {mobileExpanded === "system" && (
                    <div className="ml-4 flex flex-col gap-0.5 border-l border-border pl-3 py-1">
                      {SYSTEM_SECTIONS.map(({ key, label }) => ({ key, label, items: systemGroup.items.filter((item) => (item.section ?? "quality") === key) }))
                        .filter((section) => section.items.length > 0)
                        .map(({ key, label, items }, index) => (
                          <div key={key} className="flex flex-col gap-0.5">
                            <div className={clsx("px-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70", index === 0 ? "mt-0" : "mt-2")}>{label}</div>
                            {items.map((item) => (
                              <Link
                                key={item.key}
                                to={item.path}
                                onClick={() => setMobileOpen(false)}
                                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
                              >
                                <item.icon size={16} />
                                <span>{item.label}</span>
                              </Link>
                            ))}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}

              {documentLibrary.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setMobileExpanded(mobileExpanded === "library" ? null : "library")}
                    className={clsx(
                      "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
                      mobileExpanded === "library" ? "bg-muted" : "text-foreground hover:bg-muted"
                    )}
                  >
                    <span className="flex-1 text-left">Document Library</span>
                    <ChevronDown size={14} className={clsx("transition-transform", mobileExpanded === "library" && "rotate-180")} />
                  </button>
                  {mobileExpanded === "library" && (
                    <div className="ml-4 flex flex-col gap-0.5 border-l border-border pl-3 py-1">
                      {documentLibrary.map((dept) => (
                        <Link
                          key={dept.id}
                          to={`/documents/folders?dept=${dept.id}`}
                          onClick={() => setMobileOpen(false)}
                          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
                        >
                          <Library size={16} />
                          <span>{dept.name}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <Link
                to="/settings"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted border-t border-border mt-1 pt-3"
              >
                <Settings size={16} />
                <span>Settings</span>
              </Link>
            </>
          )}
        </div>
      )}
    </header>
  );
}

/**
 * Curated cross-department jump list for the Homepage redesign — a flat
 * shortcut to the modules a user is most likely to want directly from the
 * top nav, on top of (not instead of) the full per-department dropdowns
 * below. SCAR and Admin Console (API Access lives inside it) are included
 * here even though the Workflow Inbox/Calendar feature excludes them (no
 * real per-user assignee on SCAR, no per-user task concept on Admin Console
 * at all) — this list is pure navigation, not a per-user assignment claim.
 * "Process Flow Diagram" has no standalone route (it's a formType opened
 * inside a PPAP record) and is deliberately not listed here.
 */
const MODULES_DROPDOWN_KEYS = [
  "ncr",
  "capa",
  "audit",
  "documents",
  "suppliers",
  "training",
  "digital_twin",
  "reporting",
  "scar_forms",
  "admin_console",
];

/**
 * Filtered against `allVisibleLeaves` (not the static ALL_MODULE_LEAVES),
 * so this list narrows exactly the same way every other dropdown in this
 * nav bar does — a department with no live access to a module simply won't
 * see it here either, no second source of truth for "what can I see".
 *
 * Built on the same `NavDropdown` shell every department dropdown uses,
 * driven by the parent's shared `openId` state (hover-open, click-away/
 * Escape/other-dropdown-open all close it) — a bespoke local `useState`
 * here previously meant only its own toggle button could close it, unlike
 * every other dropdown in this bar.
 */
function ModulesDropdown({
  leaves,
  isOpen,
  onOpen,
  onScheduleClose,
  onCancelClose,
  onNavigate,
}: {
  leaves: NavLeaf[];
  isOpen: boolean;
  onOpen: () => void;
  onScheduleClose: () => void;
  onCancelClose: () => void;
  onNavigate?: () => void;
}) {
  const byKey = new Map(leaves.map((l) => [l.key, l]));
  const items = MODULES_DROPDOWN_KEYS.map((key) => byKey.get(key)).filter((l): l is NavLeaf => l != null);

  return (
    <NavDropdown id="modules" label="Modules" icon={Grid2x2} isOpen={isOpen} onOpen={onOpen} onScheduleClose={onScheduleClose} onCancelClose={onCancelClose}>
      {items.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">No modules available.</p>
      ) : (
        items.map((item) => (
          <Link
            key={item.key}
            to={item.path}
            onClick={onNavigate}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <item.icon size={16} />
            <span>{item.label}</span>
          </Link>
        ))
      )}
    </NavDropdown>
  );
}

function BrandMark({ tenant }: { tenant: { name: string } | null }) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <img src="/branding/logo-mark.png" alt="" className="h-8 w-8 rounded-md object-cover" />
      <div className="flex flex-col items-start justify-center">
        <span className="font-semibold text-foreground leading-tight tracking-wide">ACCUQUAL QMS</span>
        {tenant && <span className="text-xs text-muted-foreground leading-tight truncate max-w-[10rem]">{tenant.name}</span>}
      </div>
    </div>
  );
}

/**
 * One top-level dropdown, shared by every department + System so "closes when
 * the cursor moves off it" and "never renders off-screen" only need fixing
 * once. Opens on hover (with a short grace period so moving from the trigger
 * down into the panel doesn't flip it closed) and on click for touch/keyboard;
 * closes when the cursor leaves the trigger+panel, on Escape, or on an
 * outside click. Flips to right-aligned and caps its own height with an
 * internal scrollbar so it can never spill past the viewport's edges.
 */
function NavDropdown({
  id: _id,
  label,
  meta,
  icon: Icon,
  twoColumn = false,
  isOpen,
  onOpen,
  onScheduleClose,
  onCancelClose,
  children,
}: {
  id: DropdownId;
  label: string;
  meta?: DepartmentMeta;
  /** Icon for a dropdown with no `meta` (e.g. Modules) — `meta.icon` wins when both are given. */
  icon?: LucideIcon;
  twoColumn?: boolean;
  isOpen: boolean;
  onOpen: () => void;
  onScheduleClose: () => void;
  onCancelClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [alignRight, setAlignRight] = useState(false);

  useLayoutEffect(() => {
    if (!isOpen || !panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    const overflowsRight = rect.right > window.innerWidth - 8;
    setAlignRight(overflowsRight);
  }, [isOpen]);

  return (
    <div className="relative" onMouseEnter={onCancelClose} onMouseLeave={onScheduleClose}>
      <button
        type="button"
        onClick={() => (isOpen ? onScheduleClose() : onOpen())}
        onMouseEnter={onOpen}
        className={clsx(
          "flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap",
          isOpen
            ? meta
              ? clsx(meta.bgSoft, meta.text, "font-medium")
              : "bg-muted text-foreground font-medium"
            : "text-muted-foreground hover:bg-muted"
        )}
        aria-expanded={isOpen}
      >
        {meta ? <meta.icon size={18} className={meta.text} /> : Icon && <Icon size={18} />}
        <span>{label}</span>
        <ChevronDown size={14} className={clsx("transition-transform", isOpen && "rotate-180")} />
      </button>
      {isOpen && (
        <div
          ref={panelRef}
          className={clsx(
            "absolute top-full z-30 mt-1 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-card p-2 shadow-lg",
            // Two-column panels need real per-column width reserved, not just an
            // overall min-width — Tailwind's grid-cols-2 tracks are minmax(0,1fr),
            // so with no min width of their own a long label (e.g. "Quality
            // Inspection Reports") doesn't wrap or grow its track, it just draws
            // past the column boundary on top of the next column's text. Each
            // NavItemRow also needs min-w-0 + truncate so it can actually shrink
            // to that track width instead of forcing it wider (see below).
            twoColumn ? "grid grid-cols-2 gap-x-3 w-[32rem] max-w-[90vw]" : "flex flex-col min-w-[16rem]",
            alignRight ? "right-0" : "left-0",
            meta && "ring-1",
            meta?.ring
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function NavItemRow({
  item,
  department,
  bypass,
  liveLevel,
  kpiCounts,
  onNavigate,
}: {
  item: NavLeaf;
  department: Department;
  bypass: boolean;
  liveLevel?: AccessLevel;
  kpiCounts: KpiCounts;
  onNavigate: () => void;
}) {
  const level = effectiveAccess(item, department, bypass, liveLevel);
  if (level === "none") return null;
  const count = item.kpi ? kpiCounts[item.key as (typeof KPI_COUNT_KEYS)[number]] : undefined;

  return (
    <Link
      to={item.path}
      title={item.notes ? `${item.label} — ${item.notes}` : item.label}
      onClick={onNavigate}
      className="flex min-w-0 items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
    >
      <item.icon size={16} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {level === "read" && <Lock size={12} className="shrink-0 text-muted-foreground" aria-label="Read-only for your department" />}
      {item.kpi &&
        (count !== undefined ? (
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary tabular-nums">{count}</span>
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="KPI dashboard item" />
        ))}
    </Link>
  );
}
