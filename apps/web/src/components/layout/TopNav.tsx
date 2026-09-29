import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import clsx from "clsx";
import { ChevronDown, Command, Menu, PanelLeftClose, PanelLeftOpen, Search, Settings, X } from "lucide-react";
import { useCurrentCompany, useCurrentUser } from "../../hooks/useAuth";
import { GlobalSearchResults } from "./GlobalSearchResults";
import { NotificationDropdown } from "./NotificationDropdown";
import { WhatsNewDropdown } from "./WhatsNewDropdown";
import { SiteSwitcher } from "./SiteSwitcher";
import { UserMenu } from "./UserMenu";
import { ScanToFindDialog } from "./ScanToFindDialog";
import { ThemeToggleButton } from "./ThemeToggleButton";
import { BackButton } from "./BackButton";
import { DASHBOARD_LEAF } from "./navConfig";
import {
  flattenSidebarLinks,
  isFolder,
  pathMatches,
  sidebarNodeContainsPath,
  type SidebarFolder,
  type SidebarNode,
} from "./sidebarStructure";
import { SidebarDragChrome, SidebarOrganizeProvider, SidebarResetButton, useArrangedSidebar, useSidebarOrganize, useSidebarRow } from "./sidebarOrganize";
import { LayoutDashboard } from "lucide-react";
import { prefetchRoute } from "../../routes/pages";

const SIDEBAR_KEY = "accuqual-sidebar-collapsed";

function folderStorageKey(userId: number | undefined) {
  return `accuqual-sidebar-folders:${userId ?? "anon"}`;
}

function readOpenFolders(userId: number | undefined): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(folderStorageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function TopNav() {
  const company = useCurrentCompany();
  const user = useCurrentUser();
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
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>(() => readOpenFolders(user?.id));

  const { arranged, folders, isAdmin } = useArrangedSidebar();
  const links = flattenSidebarLinks(folders);
  const needle = query.trim().toLowerCase();
  const searchResults = needle ? links.filter((leaf) => `${leaf.label} ${leaf.key}`.toLowerCase().includes(needle)) : [];

  useEffect(() => {
    setOpenFolders(readOpenFolders(user?.id));
  }, [user?.id]);

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

  function toggleFolder(key: string, currentlyOpen: boolean) {
    setOpenFolders((current) => {
      const next = { ...current, [key]: !currentlyOpen };
      try {
        localStorage.setItem(folderStorageKey(user?.id), JSON.stringify(next));
      } catch {
        // Preference only.
      }
      return next;
    });
  }

  function folderOpen(node: SidebarFolder): boolean {
    const stored = openFolders[node.key];
    if (stored !== undefined) return stored;
    return sidebarNodeContainsPath(node, location.pathname);
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
            placeholder="Search NCRs, documents, gages…"
            aria-label="Global search"
            autoComplete="off"
          />
          <kbd className="aq-hide-sm">/</kbd>
          {query.trim() && (
            <div className="aq-search-pop" role="listbox">
              {searchResults.map((r) => (
                <Link key={r.key} to={r.path} onClick={() => setQuery("")} className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-primary/10">
                  <r.icon size={16} />
                  <span>{r.label}</span>
                </Link>
              ))}
              <GlobalSearchResults query={query} onSelect={() => setQuery("")} />
            </div>
          )}
        </div>

        <div className="aq-top-tools">
          <BackButton />
          <SiteSwitcher />
          <button type="button" className="aq-icon-btn aq-only-sm" aria-label="Search" title="Search" onClick={() => window.dispatchEvent(new Event("accuqual-open-palette"))}>
            <Search size={16} />
          </button>
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
      {isAdmin ? (
        <SidebarOrganizeProvider arranged={arranged}>
          <SidebarNav folders={folders} folderOpen={folderOpen} toggleFolder={toggleFolder} closeSide={closeSide} pathname={location.pathname} companyName={company?.name} sideCollapsed={sideCollapsed} toggleCollapsed={toggleCollapsed} />
        </SidebarOrganizeProvider>
      ) : (
        <SidebarNav folders={folders} folderOpen={folderOpen} toggleFolder={toggleFolder} closeSide={closeSide} pathname={location.pathname} companyName={company?.name} sideCollapsed={sideCollapsed} toggleCollapsed={toggleCollapsed} />
      )}
    </>
  );
}

function SidebarNav({
  folders,
  folderOpen,
  toggleFolder,
  closeSide,
  pathname,
  companyName,
  sideCollapsed,
  toggleCollapsed,
}: {
  folders: SidebarNode[];
  folderOpen: (node: SidebarFolder) => boolean;
  toggleFolder: (key: string, currentlyOpen: boolean) => void;
  closeSide: () => void;
  pathname: string;
  companyName?: string;
  sideCollapsed: boolean;
  toggleCollapsed: () => void;
}) {
  return (
    <nav className="aq-sidebar" id="sidebar" aria-label="Main navigation">
      <div className="aq-side-scroll">
        <div className="aq-nav-group">
          <NavLink to={DASHBOARD_LEAF.path} end title="Dashboard" onClick={closeSide} onMouseEnter={() => prefetchRoute(DASHBOARD_LEAF.path)} onFocus={() => prefetchRoute(DASHBOARD_LEAF.path)} className={({ isActive }) => clsx("aq-nav-link", isActive && "active")}>
            <LayoutDashboard size={18} />
            <span className="aq-nav-label">{DASHBOARD_LEAF.label}</span>
          </NavLink>
        </div>
        {folders.map((node) =>
          isFolder(node) ? (
            <FolderBlock key={node.key} node={node} open={folderOpen(node)} onToggle={() => toggleFolder(node.key, folderOpen(node))} isOpen={folderOpen} onToggleKey={toggleFolder} onNavigate={closeSide} pathname={pathname} />
          ) : (
            <LeafLink key={node.key} node={node} onNavigate={closeSide} pathname={pathname} />
          ),
        )}
      </div>
      <div className="aq-side-foot">
        <NavLink to="/settings" title="Settings" onClick={closeSide} onMouseEnter={() => prefetchRoute("/settings")} onFocus={() => prefetchRoute("/settings")} className={({ isActive }) => clsx("aq-nav-link", isActive && "active")}>
          <Settings size={18} />
          <span className="aq-nav-label">Settings</span>
        </NavLink>
        {companyName && <p className="mt-2 truncate">{companyName}</p>}
        <SidebarResetButton />
        <button type="button" className="aq-collapse" onClick={toggleCollapsed} aria-label={sideCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {sideCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          <span>Collapse</span>
        </button>
      </div>
    </nav>
  );
}

function FolderBlock({
  node,
  open,
  onToggle,
  isOpen,
  onToggleKey,
  onNavigate,
  pathname,
  nested,
}: {
  node: SidebarFolder;
  open: boolean;
  onToggle: () => void;
  isOpen: (node: SidebarFolder) => boolean;
  onToggleKey: (key: string, currentlyOpen: boolean) => void;
  onNavigate: () => void;
  pathname: string;
  nested?: boolean;
}) {
  const active = sidebarNodeContainsPath(node, pathname);
  const row = useSidebarRow(node.key, true);
  return (
    <div className={clsx("aq-nav-group", nested && "aq-nav-nested")}>
      <div className={clsx("aq-nav-link aq-nav-folder", active && !node.path && "active", row.dropClass)} onDragOver={row.onDragOver} onDragLeave={row.onDragLeave} onDrop={row.onDrop}>
        <SidebarDragChrome itemKey={node.key} label={node.label} />
        {node.path ? (
          <NavLink to={node.path} onClick={onNavigate} onMouseEnter={() => prefetchRoute(node.path!)} onFocus={() => prefetchRoute(node.path!)} className={() => clsx("aq-nav-folder-link", pathMatches(pathname, node.path!) && "active")} title={node.label}>
            <node.icon size={18} className="shrink-0" />
            <span className="aq-nav-label min-w-0 flex-1 truncate text-left">{node.label}</span>
          </NavLink>
        ) : (
          <button type="button" className="aq-nav-folder-link" onClick={onToggle}>
            <node.icon size={18} className="shrink-0" />
            <span className="aq-nav-label min-w-0 flex-1 truncate text-left">{node.label}</span>
          </button>
        )}
        <button type="button" className="aq-nav-chevron-btn" aria-expanded={open} aria-label={open ? `Collapse ${node.label}` : `Expand ${node.label}`} onClick={onToggle}>
          <ChevronDown size={14} className={clsx("aq-nav-chevron", open && "open")} />
        </button>
      </div>
      {open && (
        <div className="aq-nav-children">
          {node.children.map((child) =>
            isFolder(child) ? (
              <FolderBlock
                key={child.key}
                node={child}
                open={isOpen(child)}
                onToggle={() => onToggleKey(child.key, isOpen(child))}
                isOpen={isOpen}
                onToggleKey={onToggleKey}
                onNavigate={onNavigate}
                pathname={pathname}
                nested
              />
            ) : (
              <LeafLink key={child.key} node={child} onNavigate={onNavigate} pathname={pathname} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function LeafLink({ node, onNavigate, pathname }: { node: SidebarNode & { path: string }; onNavigate: () => void; pathname: string }) {
  const row = useSidebarRow(node.key, false);
  const organize = useSidebarOrganize();
  if (isFolder(node) || !node.path) return null;
  const active = pathMatches(pathname, node.path);
  if (!organize) {
    return (
      <NavLink to={node.path} title={node.label} onClick={onNavigate} onMouseEnter={() => prefetchRoute(node.path)} onFocus={() => prefetchRoute(node.path)} className={() => clsx("aq-nav-link aq-nav-child", active && "active")}>
        <node.icon size={16} className="shrink-0" />
        <span className="aq-nav-label min-w-0 flex-1 truncate">{node.label}</span>
      </NavLink>
    );
  }
  return (
    <div className={clsx("aq-nav-link aq-nav-folder aq-nav-child", active && "active", row.dropClass)} onDragOver={row.onDragOver} onDragLeave={row.onDragLeave} onDrop={row.onDrop}>
      <SidebarDragChrome itemKey={node.key} label={node.label} />
      <NavLink to={node.path} title={node.label} onClick={onNavigate} onMouseEnter={() => prefetchRoute(node.path)} onFocus={() => prefetchRoute(node.path)} className={() => clsx("aq-nav-folder-link", active && "active")}>
        <node.icon size={16} className="shrink-0" />
        <span className="aq-nav-label min-w-0 flex-1 truncate">{node.label}</span>
      </NavLink>
    </div>
  );
}
