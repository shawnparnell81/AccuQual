import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Building2, ChevronDown, Library, Lock, Menu, MoreHorizontal, Search, Settings, X, type LucideIcon } from "lucide-react";
import { apiClient } from "../../api/client";
import { useCurrentTenant, useCurrentUser } from "../../hooks/useAuth";
import { HomeButton } from "./HomeButton";
import { CalendarButton } from "./CalendarButton";
import { BackButton } from "./BackButton";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { extraGrantedLeaves, useNavVisibility } from "./navVisibility";
import { useDepartmentPermissionsGrid } from "../../hooks/useDepartmentPermissionsGrid";
import { GlobalSearchResults } from "./GlobalSearchResults";
import { NotificationDropdown } from "./NotificationDropdown";
import { WhatsNewDropdown } from "./WhatsNewDropdown";
import { SiteSwitcher } from "./SiteSwitcher";
import { UserMenu } from "./UserMenu";
import { ScanToFindDialog } from "./ScanToFindDialog";
import {
  DASHBOARD_LEAF,
  DEPARTMENTS,
  KPI_COUNT_KEYS,
  PLATFORM_LEAF,
  type AccessLevel,
  type Department,
  type DepartmentMeta,
  type NavGroup,
  type NavLeaf,
} from "./navConfig";
import { PRIMARY_NAV, PRIMARY_NAV_KEYS, navSearchText, plainNav } from "../../lib/opsLanguage";
import { useSiteStore } from "../../store/siteStore";

type KpiCounts = Partial<Record<(typeof KPI_COUNT_KEYS)[number], number>>;
type DropdownId = "more";

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
  { key: "quality", label: "Records & training" },
  { key: "admin", label: "Admin" },
  { key: "advanced", label: "Rare tools" },
];

function useKpiCounts() {
  const siteId = useSiteStore((s) => s.currentSiteId);
  const { data } = useQuery({
    queryKey: ["nav-kpi-counts", siteId],
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

  const needle = query.trim().toLowerCase();
  const searchResults = needle ? allVisibleLeaves.filter((leaf) => navSearchText(leaf.key, leaf.label).includes(needle)) : [];
  const primaryLeaves = PRIMARY_NAV.map((item) => allVisibleLeaves.find((leaf) => leaf.key === item.key)).filter((leaf): leaf is NavLeaf => leaf != null);

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
                isActive ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-secondary"
              )
            }
          >
            <Building2 size={18} />
            <span>Platform Admin</span>
          </NavLink>
          <div className="ml-auto">
            <UserMenu />
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="relative border-b border-border bg-card" ref={navRef}>
      <div className="flex h-14 items-center gap-3 px-4">
        <BrandMark tenant={tenant} />

        {/* Everyday work sits on the bar; everything else is one grouped More menu.
            Below ~1400px the labels drop to icons (names stay as tooltips) so the
            bar never wraps onto a second row. */}
        <nav className="hidden min-w-0 flex-1 items-center gap-0.5 md:flex">
          <BackButton />
          <HomeButton />
          {primaryLeaves.map((item) => {
            const plain = plainNav(item.key, item.label);
            return (
              <NavLink
                key={item.key}
                to={item.path}
                title={plain.standard ? `${plain.label} (${plain.standard})` : plain.label}
                className={({ isActive }) =>
                  clsx(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-2 text-sm whitespace-nowrap",
                    isActive ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-secondary"
                  )
                }
              >
                <item.icon size={17} />
                <span className="hidden min-[1400px]:inline">{plain.label}</span>
              </NavLink>
            );
          })}
          <NavDropdown
            id="more"
            label="More"
            icon={MoreHorizontal}
            twoColumn
            isOpen={openId === "more"}
            onOpen={() => openNow("more")}
            onScheduleClose={() => scheduleClose("more")}
            onCancelClose={cancelClose}
          >
            <MoreLinks
              departmentGroups={departmentGroups}
              systemGroup={systemGroup}
              documentLibrary={documentLibrary}
              userDept={userDept}
              myEffective={myEffective}
              departmentPermissionsGrid={departmentPermissionsGrid}
              isAdmin={isAdmin}
              kpiCounts={kpiCounts}
              onNavigate={() => setOpenId(null)}
            />
          </NavDropdown>
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {/* Quick-nav search — client-side filter over the modules, plus the real
              GET /search results in the same dropdown. Ctrl/Cmd+K opens the full palette. */}
          <div className="relative hidden w-44 md:block lg:w-56">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full rounded-full border border-form-field bg-background py-1.5 pl-8 pr-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            {query.trim() && (
              <div className="absolute right-0 top-full z-30 mt-1 max-h-[70vh] w-72 overflow-y-auto rounded-md border border-border bg-card p-1 shadow-lg">
                {searchResults.map((r) => (
                  <Link key={r.key} to={r.path} onClick={() => setQuery("")} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary">
                    <r.icon size={16} />
                    <span>{plainNav(r.key, r.label).label}</span>
                  </Link>
                ))}
                <GlobalSearchResults query={query} onSelect={() => setQuery("")} />
              </div>
            )}
          </div>

          <ScanToFindDialog />
          <div className="hidden md:block">
            <CalendarButton iconOnly />
          </div>
          <div className="hidden lg:block">
            <SiteSwitcher />
          </div>
          <NotificationDropdown />
          <WhatsNewDropdown />
          <UserMenu />

          <button type="button" onClick={() => setMobileOpen((v) => !v)} className="rounded-md p-2 hover:bg-secondary md:hidden" aria-label="Toggle navigation menu">
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile accordion */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-card px-4 py-3 flex flex-col gap-1 max-h-[calc(100vh-3.5rem)] overflow-y-auto">
          <div className="relative mb-2">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a record or page…"
              className="w-full rounded-md border border-form-field bg-background py-1.5 pl-8 pr-2 text-sm outline-none focus:ring-1 focus:ring-ring"
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
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
                >
                  <r.icon size={16} />
                  <span>{plainNav(r.key, r.label).label}</span>
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
              {primaryLeaves.map((item) => {
                const plain = plainNav(item.key, item.label);
                return (
                  <Link
                    key={item.key}
                    to={item.path}
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
                  >
                    <item.icon size={16} />
                    <span>{plain.label}</span>
                    {plain.standard && <span className="text-[10px] uppercase tracking-wide">{plain.standard}</span>}
                  </Link>
                );
              })}
              <div>
                <button
                  type="button"
                  onClick={() => setMobileExpanded(mobileExpanded === "more" ? null : "more")}
                  className={clsx(
                    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
                    mobileExpanded === "more" ? "bg-muted" : "text-foreground hover:bg-secondary"
                  )}
                >
                  <MoreHorizontal size={18} />
                  <span className="flex-1 text-left">More</span>
                  <ChevronDown size={14} className={clsx("transition-transform", mobileExpanded === "more" && "rotate-180")} />
                </button>
                {mobileExpanded === "more" && (
                  <div className="ml-4 flex flex-col gap-0.5 border-l border-border pl-3 py-1">
                    <MoreLinks
                      departmentGroups={departmentGroups}
                      systemGroup={systemGroup}
                      documentLibrary={documentLibrary}
                      userDept={userDept}
                      myEffective={myEffective}
                      departmentPermissionsGrid={departmentPermissionsGrid}
                      isAdmin={isAdmin}
                      kpiCounts={kpiCounts}
                      onNavigate={() => setMobileOpen(false)}
                    />
                  </div>
                )}
              </div>

              <Link
                to="/settings"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary border-t border-border mt-1 pt-3"
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

/** Departments roll up into a handful of areas so the menu reads as "where do I work", not a folder per department. */
const AREA_OF: Record<string, string> = {
  quality: "Quality",
  engineering: "Engineering",
  production: "Operations",
  material_management: "Operations",
  purchasing: "Supply chain",
  customer_service: "Customers",
  sales_and_marketing: "Customers",
};
const AREA_ORDER = ["Quality", "Engineering", "Operations", "Supply chain", "Customers"];

function AreaHeading({ children }: { children: React.ReactNode }) {
  return <div className="col-span-full mt-2 border-t border-border/60 px-3 pt-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 first:mt-0 first:border-0 first:pt-0">{children}</div>;
}

function MoreLinks({
  departmentGroups,
  systemGroup,
  documentLibrary,
  userDept,
  myEffective,
  departmentPermissionsGrid,
  isAdmin,
  kpiCounts,
  onNavigate,
}: {
  departmentGroups: NavGroup[];
  systemGroup: { items: NavLeaf[] } | undefined;
  documentLibrary: { id: number; name: string }[];
  userDept: Department | null | undefined;
  myEffective: Partial<Record<string, AccessLevel>> | undefined;
  departmentPermissionsGrid: Map<Department, Map<string, AccessLevel>>;
  isAdmin: boolean;
  kpiCounts: KpiCounts;
  onNavigate: () => void;
}) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const matches = (item: NavLeaf) => !needle || navSearchText(item.key, item.label).includes(needle);

  // Each module shows once, under the area of the department that natively owns it. An admin's "live-granted extras" would otherwise repeat every module under every department, so extras only fill in modules no department lists itself.
  const areas = new Map<string, { department: Department; item: NavLeaf; liveLevel?: AccessLevel }[]>();
  const placed = new Set<string>();
  const place = (group: NavGroup, items: NavLeaf[]) => {
    const department = group.department!;
    const isOwnDept = department === userDept;
    for (const item of items) {
      if (PRIMARY_NAV_KEYS.has(item.key) || placed.has(item.key)) continue;
      const liveLevel = isOwnDept ? myEffective?.[item.key] : departmentPermissionsGrid.get(department)?.get(item.key);
      if (effectiveAccess(item, department, isAdmin, liveLevel) === "none" || !matches(item)) continue;
      placed.add(item.key);
      const area = AREA_OF[department] ?? DEPARTMENTS.find((d) => d.key === department)?.label ?? "Other";
      const rows = areas.get(area) ?? [];
      rows.push({ department, item, liveLevel });
      areas.set(area, rows);
    }
  };
  const namedGroups = departmentGroups.filter((group) => group.department);
  // A module belongs to the department that can edit it; a department that can only read it doesn't claim it.
  const owners = new Map<string, Department>();
  for (const group of namedGroups) {
    const department = group.department!;
    for (const item of group.items) {
      if (item.access[department] === "edit" && !owners.has(item.key)) owners.set(item.key, department);
    }
  }
  for (const group of namedGroups) {
    place(group, group.items.filter((item) => !owners.has(item.key) || owners.get(item.key) === group.department).sort((x, y) => x.priority - y.priority));
  }
  for (const group of namedGroups) {
    const extra = extraGrantedLeaves(group, group.department === userDept, myEffective, departmentPermissionsGrid);
    place(group, [...extra].sort((x, y) => x.priority - y.priority));
  }
  const orderedAreas = [...areas.keys()].sort((x, y) => (AREA_ORDER.indexOf(x) === -1 ? 99 : AREA_ORDER.indexOf(x)) - (AREA_ORDER.indexOf(y) === -1 ? 99 : AREA_ORDER.indexOf(y)));

  return (
    <>
      <div className="col-span-full mb-1 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter modules…"
            className="w-full rounded-md border border-form-field bg-background py-1.5 pl-8 pr-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <Link to={DASHBOARD_LEAF.path} onClick={onNavigate} className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-secondary">
          <DASHBOARD_LEAF.icon size={15} />
          Overview
        </Link>
      </div>
      {orderedAreas.map((area) => (
        <div key={area} className="contents">
          <AreaHeading>{area}</AreaHeading>
          {areas.get(area)!.map(({ department, item, liveLevel }) => (
            <NavItemRow key={`${department}-${item.key}`} item={item} department={department} bypass={isAdmin} liveLevel={liveLevel} kpiCounts={kpiCounts} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
      {systemGroup &&
        SYSTEM_SECTIONS.map(({ key, label }) => {
          const items = systemGroup.items.filter((item) => (item.section ?? "quality") === key && !PRIMARY_NAV_KEYS.has(item.key) && matches(item));
          if (items.length === 0) return null;
          return (
            <div key={key} className="contents">
              <AreaHeading>{label}</AreaHeading>
              {items.map((item) => (
                <PlainLeafLink key={item.key} item={item} onNavigate={onNavigate} />
              ))}
            </div>
          );
        })}
      {!needle && documentLibrary.length > 0 && (
        <div className="contents">
          <AreaHeading>Document folders</AreaHeading>
          {documentLibrary.map((dept) => (
            <Link
              key={dept.id}
              to={`/documents/folders?dept=${dept.id}`}
              title={`Open the ${dept.name} folder`}
              onClick={onNavigate}
              className="flex min-w-0 items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
            >
              <Library size={16} className="shrink-0" />
              <span className="min-w-0 truncate">{dept.name}</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function PlainLeafLink({ item, onNavigate }: { item: NavLeaf; onNavigate: () => void }) {
  const plain = plainNav(item.key, item.label);
  return (
    <Link
      to={item.path}
      title={item.notes ? `${plain.label} — ${item.notes}` : plain.label}
      onClick={onNavigate}
      className="flex min-w-0 items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
    >
      <item.icon size={16} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{plain.label}</span>
      {plain.standard && <span className="shrink-0 text-[10px] text-muted-foreground">{plain.standard}</span>}
    </Link>
  );
}

function BrandMark({ tenant }: { tenant: { name: string } | null }) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <span className="h-8 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
      <img src="/branding/logo-mark.png" alt="" className="h-8 w-8 rounded-md object-cover" />
      <div className="hidden flex-col items-start justify-center sm:flex">
        <span className="font-semibold leading-tight tracking-wide text-foreground">ACCUQUAL</span>
        {tenant && <span className="max-w-[9rem] truncate text-[11px] leading-tight text-muted-foreground">{tenant.name}</span>}
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
            : "text-muted-foreground hover:bg-secondary"
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
            twoColumn ? "grid grid-cols-3 gap-x-2 w-[52rem] max-w-[94vw]" : "flex flex-col min-w-[16rem]",
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
  const plain = plainNav(item.key, item.label);

  return (
    <Link
      to={item.path}
      title={item.notes ? `${plain.label} — ${item.notes}` : plain.label}
      onClick={onNavigate}
      className="flex min-w-0 items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
    >
      <item.icon size={16} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{plain.label}</span>
      {plain.standard && <span className="shrink-0 text-[10px] text-muted-foreground">{plain.standard}</span>}
      {level === "read" && <Lock size={12} className="shrink-0 text-muted-foreground" aria-label="Read-only for your department" />}
      {item.kpi &&
        (count !== undefined ? (
          <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent tabular-nums">{count}</span>
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="KPI dashboard item" />
        ))}
    </Link>
  );
}
