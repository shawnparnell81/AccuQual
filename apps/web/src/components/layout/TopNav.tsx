import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Command, Library, Lock, Menu, PanelLeftClose, PanelLeftOpen, Search, Settings, X } from "lucide-react";
import { apiClient } from "../../api/client";
import { useCurrentCompany, useCurrentUser } from "../../hooks/useAuth";
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
import { ThemeToggleButton } from "./ThemeToggleButton";
import {
  DASHBOARD_LEAF,
  DEPARTMENTS,
  KPI_COUNT_KEYS,
  type AccessLevel,
  type Department,
  type NavGroup,
  type NavLeaf,
} from "./navConfig";
import { navSearchText, plainNav } from "../../lib/opsLanguage";
import { useSiteStore } from "../../store/siteStore";

type KpiCounts = Partial<Record<(typeof KPI_COUNT_KEYS)[number], number>>;

const SIDEBAR_KEY = "accuqual-sidebar-collapsed";

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

function useDocumentLibraryTopLevel() {
  const { data = [] } = useQuery({
    queryKey: ["document-folders"],
    queryFn: async () => (await apiClient.get<DocumentFolderNode[]>("/document-folders")).data,
    staleTime: 30_000,
  });
  return data.filter((f) => f.parentId === null && f.name !== LIBRARY_POOL_NAME);
}

function effectiveAccess(leaf: NavLeaf, department: Department, bypass: boolean, liveLevel?: AccessLevel): AccessLevel {
  if (bypass) return "edit";
  if (liveLevel !== undefined) return liveLevel;
  return leaf.access[department] ?? "none";
}

const SYSTEM_SECTIONS: { key: "quality" | "admin" | "advanced"; label: string }[] = [
  { key: "quality", label: "Documents & people" },
  { key: "admin", label: "System" },
  { key: "advanced", label: "Rare tools" },
];

/** Departments roll up into a handful of areas so the sidebar reads as "where do I work". */
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

export function TopNav() {
  const company = useCurrentCompany();
  const user = useCurrentUser();
  const isAdmin = user?.roleName === "admin";
  const userDept = user?.department as Department | null | undefined;
  const { effective: myEffective } = useEffectivePermissions();
  const departmentPermissionsGrid = useDepartmentPermissionsGrid(isAdmin);
  const kpiCounts = useKpiCounts();
  const documentLibrary = useDocumentLibraryTopLevel();
  const location = useLocation();

  const [sideOpen, setSideOpen] = useState(false);
  const [sideCollapsed, setSideCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [query, setQuery] = useState("");

  const { visibleGroups, allVisibleLeaves } = useNavVisibility();
  const needle = query.trim().toLowerCase();
  const searchResults = needle ? allVisibleLeaves.filter((leaf) => navSearchText(leaf.key, leaf.label).includes(needle)) : [];

  useEffect(() => {
    setSideOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.body.classList.toggle("side-collapsed", sideCollapsed);
    document.body.classList.toggle("side-open", sideOpen);
    return () => {
      document.body.classList.remove("side-collapsed", "side-open");
    };
  }, [sideCollapsed, sideOpen]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSideOpen(false);
        setQuery("");
      }
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        document.getElementById("gsearch")?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function toggleCollapsed() {
    setSideCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        // Preference only — the layout still toggles for this session.
      }
      return next;
    });
  }

  function closeSide() {
    setSideOpen(false);
  }

  return (
    <>
      <a className="aq-skip" href="#main-content">
        Skip to content
      </a>
      <header className="aq-topbar">
        <button type="button" className="aq-icon-btn aq-menu-btn" aria-label="Open navigation" aria-expanded={sideOpen} onClick={() => setSideOpen((v) => !v)}>
          {sideOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
        <Link to="/" className="aq-brand" aria-label="AccuQual QMS home">
          <img src="/branding/logo-mark.png" alt="" width={26} height={31} />
          <span>
            ACCU<b>QUAL</b>
          </span>
          <span className="aq-qms">QMS</span>
        </Link>

        <div className="aq-search" role="search">
          <Search size={16} />
          <input
            id="gsearch"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search issues, fixes, documents, gages…"
            aria-label="Global search"
            autoComplete="off"
          />
          <kbd className="aq-hide-sm">/</kbd>
          {query.trim() && (
            <div className="aq-search-pop" role="listbox">
              {searchResults.map((r) => (
                <Link key={r.key} to={r.path} onClick={() => setQuery("")} className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-primary/10">
                  <r.icon size={16} />
                  <span>{plainNav(r.key, r.label).label}</span>
                </Link>
              ))}
              <GlobalSearchResults query={query} onSelect={() => setQuery("")} />
            </div>
          )}
        </div>

        <div className="aq-top-tools">
          <BackButton />
          <SiteSwitcher />
          <button type="button" className="aq-icon-btn aq-hide-sm" aria-label="Open command palette (Ctrl+K)" title="Command palette (Ctrl/⌘+K)" onClick={() => window.dispatchEvent(new Event("accuqual-open-palette"))}>
            <Command size={16} />
          </button>
          <ScanToFindDialog />
          <ThemeToggleButton />
          <NotificationDropdown />
          <WhatsNewDropdown />
          <UserMenu />
        </div>
      </header>

      <div className="aq-scrim" onClick={closeSide} />
      <nav className="aq-sidebar" id="sidebar" aria-label="Main navigation">
        <div className="aq-side-scroll">
          <div className="aq-nav-group">
            <h4>Overview</h4>
            <NavLink to={DASHBOARD_LEAF.path} end title="Dashboard" onClick={closeSide} className={({ isActive }) => clsx("aq-nav-link", isActive && "active")}>
              <DASHBOARD_LEAF.icon size={18} />
              <span className="aq-nav-label">{DASHBOARD_LEAF.label}</span>
            </NavLink>
            <HomeButton onNavigate={closeSide} />
            <CalendarButton onNavigate={closeSide} />
          </div>
          <SidebarLinks
            departmentGroups={visibleGroups.filter((g) => g.department !== null)}
            systemGroup={visibleGroups.find((g) => g.department === null)}
            documentLibrary={documentLibrary}
            userDept={userDept}
            myEffective={myEffective}
            departmentPermissionsGrid={departmentPermissionsGrid}
            isAdmin={isAdmin}
            kpiCounts={kpiCounts}
            onNavigate={closeSide}
          />
        </div>
        <div className="aq-side-foot">
          <p>Built around ISO 9001 / IATF 16949 practices.</p>
          {company?.name && <p className="mt-1.5 truncate">{company.name}</p>}
          <button type="button" className="aq-collapse" onClick={toggleCollapsed} aria-label={sideCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {sideCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            <span>Collapse</span>
          </button>
        </div>
      </nav>
    </>
  );
}

function SidebarLinks({
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

  const areas = new Map<string, { department: Department; item: NavLeaf; liveLevel?: AccessLevel }[]>();
  const placed = new Set<string>();
  const place = (group: NavGroup, items: NavLeaf[]) => {
    const department = group.department!;
    const isOwnDept = department === userDept;
    for (const item of items) {
      if (placed.has(item.key)) continue;
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
  const owners = new Map<string, Department>();
  for (const group of namedGroups) {
    const department = group.department!;
    for (const item of group.items) {
      if (item.access[department] === "edit" && !owners.has(item.key)) owners.set(item.key, department);
    }
  }
  for (const group of namedGroups) {
    place(
      group,
      group.items.filter((item) => !owners.has(item.key) || owners.get(item.key) === group.department).sort((x, y) => x.priority - y.priority)
    );
  }
  for (const group of namedGroups) {
    const extra = extraGrantedLeaves(group, group.department === userDept, myEffective, departmentPermissionsGrid);
    place(group, [...extra].sort((x, y) => x.priority - y.priority));
  }
  const orderedAreas = [...areas.keys()].sort((x, y) => (AREA_ORDER.indexOf(x) === -1 ? 99 : AREA_ORDER.indexOf(x)) - (AREA_ORDER.indexOf(y) === -1 ? 99 : AREA_ORDER.indexOf(y)));

  return (
    <>
      <div className="aq-side-filter">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter modules…" aria-label="Filter modules" />
      </div>
      {orderedAreas.map((area) => (
        <div key={area} className="aq-nav-group">
          <h4>{area}</h4>
          {areas.get(area)!.map(({ department, item, liveLevel }) => (
            <NavItemRow key={`${department}-${item.key}`} item={item} department={department} bypass={isAdmin} liveLevel={liveLevel} kpiCounts={kpiCounts} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
      {systemGroup &&
        SYSTEM_SECTIONS.map(({ key, label }) => {
          const items = systemGroup.items.filter((item) => (item.section ?? "quality") === key && matches(item));
          const showSettings = key === "admin" && (!needle || "settings".includes(needle));
          if (items.length === 0 && !showSettings) return null;
          return (
            <div key={key} className="aq-nav-group">
              <h4>{label}</h4>
              {items.map((item) => (
                <PlainLeafLink key={item.key} item={item} onNavigate={onNavigate} />
              ))}
              {showSettings && (
                <NavLink to="/settings" title="Settings" onClick={onNavigate} className={({ isActive }) => clsx("aq-nav-link", isActive && "active")}>
                  <Settings size={18} />
                  <span className="aq-nav-label">Settings</span>
                </NavLink>
              )}
            </div>
          );
        })}
      {!needle && documentLibrary.length > 0 && (
        <div className="aq-nav-group">
          <h4>Document folders</h4>
          {documentLibrary.map((dept) => (
            <Link key={dept.id} to={`/documents/folders?dept=${dept.id}`} title={`Open the ${dept.name} folder`} onClick={onNavigate} className="aq-nav-link">
              <Library size={18} className="shrink-0" />
              <span className="aq-nav-label min-w-0 truncate">{dept.name}</span>
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
    <NavLink to={item.path} title={item.notes ? `${plain.label} — ${item.notes}` : plain.label} onClick={onNavigate} className={({ isActive }) => clsx("aq-nav-link", isActive && "active")}>
      <item.icon size={18} className="shrink-0" />
      <span className="aq-nav-label min-w-0 flex-1 truncate">{plain.label}</span>
      {plain.standard && <span className="aq-nav-std">{plain.standard}</span>}
    </NavLink>
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
    <NavLink to={item.path} title={item.notes ? `${plain.label} — ${item.notes}` : plain.label} onClick={onNavigate} className={({ isActive }) => clsx("aq-nav-link", isActive && "active")}>
      <item.icon size={18} className="shrink-0" />
      <span className="aq-nav-label min-w-0 flex-1 truncate">{plain.label}</span>
      {typeof count === "number" && count > 0 && <span className="aq-nav-count">{count}</span>}
      {plain.standard && <span className="aq-nav-std">{plain.standard}</span>}
      {level === "read" && <Lock size={12} className="shrink-0 text-muted-foreground" aria-label="Read-only for your department" />}
    </NavLink>
  );
}
