import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
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
  sidebarLinkOpensNewTab,
  sidebarNodeContainsPath,
  type SidebarFolder,
  type SidebarLink,
  type SidebarNode,
} from "./sidebarStructure";
import { SidebarDragChrome, SidebarOrganizeProvider, SidebarResetButton, useArrangedSidebar, useSidebarOrganize, useSidebarRow } from "./sidebarOrganize";
import { SidebarShortcutsButton } from "./sidebarShortcutsPanel";
import { SHORTCUTS_FOLDER_KEY, isPersonalShortcutKey } from "../../lib/sidebarShortcuts";
import { LayoutDashboard } from "lucide-react";
import { prefetchRoute } from "../../routes/pages";
import { DmaLogo, PRODUCT_LINE, ProductLine } from "../brand/DmaLogo";
import {
  SIDEBAR_RAIL_WIDTH,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  appliedSidebarWidth,
  clampSidebarWidth,
  maxSidebarWidth,
  readSidebarWidth,
  widthAfterDrag,
  writeSidebarWidth,
} from "../../lib/sidebarWidth";

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
  const [sideWidth, setSideWidth] = useState(() => {
    try {
      return readSidebarWidth(localStorage);
    } catch {
      return SIDEBAR_WIDTH_DEFAULT;
    }
  });
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [query, setQuery] = useState("");
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>(() => readOpenFolders(user?.id));

  const { arranged, folders, catalog, isAdmin } = useArrangedSidebar();
  const links = flattenSidebarLinks(folders);
  const needle = query.trim().toLowerCase();
  const searchResults = needle ? links.filter((leaf) => `${leaf.label} ${leaf.key}`.toLowerCase().includes(needle)) : [];

  useEffect(() => {
    setOpenFolders(readOpenFolders(user?.id));
  }, [user?.id]);

  useEffect(() => {
    setSideOpen(false);
  }, [location.pathname]);

  useLayoutEffect(() => {
    const apply = () => {
      const viewport = window.innerWidth;
      setViewportWidth(viewport);
      document.body.classList.toggle("side-collapsed", sideCollapsed);
      document.body.classList.toggle("side-open", sideOpen);
      const applied = appliedSidebarWidth(sideWidth, viewport, sideCollapsed);
      if (applied == null) document.documentElement.style.removeProperty("--side-w");
      else document.documentElement.style.setProperty("--side-w", `${applied}px`);
    };
    apply();
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      document.body.classList.remove("side-collapsed", "side-open");
      document.documentElement.style.removeProperty("--side-w");
    };
  }, [sideCollapsed, sideOpen, sideWidth]);

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

  function persistCollapsed(next: boolean) {
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
    } catch {
      // Preference only — the layout still toggles for this session.
    }
  }

  function toggleCollapsed() {
    setSideCollapsed((current) => {
      const next = !current;
      persistCollapsed(next);
      return next;
    });
  }

  function setPanelWidth(next: number) {
    const clamped = clampSidebarWidth(next, window.innerWidth);
    setSideCollapsed(false);
    persistCollapsed(false);
    setSideWidth(clamped);
    try {
      writeSidebarWidth(localStorage, clamped);
    } catch {
      // Preference only.
    }
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
    if (node.key === SHORTCUTS_FOLDER_KEY) return true;
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
        <Link to="/" className="aq-brand" aria-label={PRODUCT_LINE}>
          <DmaLogo height={34} />
          <ProductLine />
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
              {searchResults.map((r) =>
                sidebarLinkOpensNewTab(r) ? (
                  <a key={r.key} href={r.path} target="_blank" rel="noopener noreferrer" onClick={() => setQuery("")} className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-primary/10">
                    <r.icon size={16} />
                    <span>{r.label}</span>
                  </a>
                ) : (
                  <Link key={r.key} to={r.path} onClick={() => setQuery("")} className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-primary/10">
                    <r.icon size={16} />
                    <span>{r.label}</span>
                  </Link>
                ),
              )}
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
          <SidebarNav folders={folders} catalog={catalog} folderOpen={folderOpen} toggleFolder={toggleFolder} closeSide={closeSide} pathname={location.pathname} companyName={company?.name} sideCollapsed={sideCollapsed} toggleCollapsed={toggleCollapsed} sideWidth={sideWidth} viewportWidth={viewportWidth} onPanelWidth={setPanelWidth} />
        </SidebarOrganizeProvider>
      ) : (
        <SidebarNav folders={folders} catalog={catalog} folderOpen={folderOpen} toggleFolder={toggleFolder} closeSide={closeSide} pathname={location.pathname} companyName={company?.name} sideCollapsed={sideCollapsed} toggleCollapsed={toggleCollapsed} sideWidth={sideWidth} viewportWidth={viewportWidth} onPanelWidth={setPanelWidth} />
      )}
    </>
  );
}

function SidebarNav({
  folders,
  catalog,
  folderOpen,
  toggleFolder,
  closeSide,
  pathname,
  companyName,
  sideCollapsed,
  toggleCollapsed,
  sideWidth,
  viewportWidth,
  onPanelWidth,
}: {
  folders: SidebarNode[];
  catalog: SidebarNode[];
  folderOpen: (node: SidebarFolder) => boolean;
  toggleFolder: (key: string, currentlyOpen: boolean) => void;
  closeSide: () => void;
  pathname: string;
  companyName?: string;
  sideCollapsed: boolean;
  toggleCollapsed: () => void;
  sideWidth: number;
  viewportWidth: number;
  onPanelWidth: (width: number) => void;
}) {
  return (
    <nav className="aq-sidebar" id="sidebar" aria-label="Main navigation">
      <div className="aq-side-scroll">
        <div className="aq-side-brand">
          <DmaLogo height={32} />
        </div>
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
        <SidebarShortcutsButton catalog={catalog} />
        <SidebarResetButton />
        <button type="button" className="aq-collapse" onClick={toggleCollapsed} aria-label={sideCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {sideCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          <span>{sideCollapsed ? "Expand" : "Collapse"}</span>
        </button>
      </div>
      <SidebarResizeHandle collapsed={sideCollapsed} width={sideWidth} viewportWidth={viewportWidth} onPanelWidth={onPanelWidth} />
    </nav>
  );
}

function SidebarResizeHandle({
  collapsed,
  width,
  viewportWidth,
  onPanelWidth,
}: {
  collapsed: boolean;
  width: number;
  viewportWidth: number;
  onPanelWidth: (width: number) => void;
}) {
  const max = maxSidebarWidth(viewportWidth);
  const shown = collapsed ? SIDEBAR_RAIL_WIDTH : clampSidebarWidth(width, viewportWidth);
  const lastPointerDown = useRef(0);
  const gesture = useRef<{ reset: boolean } | null>(null);

  function applyDrag(startWidth: number, deltaX: number, wasCollapsed: boolean) {
    const result = widthAfterDrag(startWidth, deltaX, window.innerWidth, wasCollapsed);
    if (!result.collapsed) onPanelWidth(result.width);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const now = event.timeStamp;
    if (lastPointerDown.current > 0 && (event.detail > 1 || now - lastPointerDown.current < 400)) {
      lastPointerDown.current = 0;
      if (gesture.current) gesture.current.reset = true;
      onPanelWidth(SIDEBAR_WIDTH_DEFAULT);
      return;
    }
    lastPointerDown.current = now;
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = collapsed ? SIDEBAR_RAIL_WIDTH : shown;
    const wasCollapsed = collapsed;
    const token = { reset: false };
    gesture.current = token;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // The pointer can already be gone. The move listeners still resize.
    }
    document.body.classList.add("aq-side-resizing");
    const move = (ev: PointerEvent) => {
      if (!token.reset) applyDrag(startWidth, ev.clientX - startX, wasCollapsed);
    };
    const finish = (ev: PointerEvent) => {
      document.body.classList.remove("aq-side-resizing");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      if (!token.reset) applyDrag(startWidth, ev.clientX - startX, wasCollapsed);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 48 : 24;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (collapsed) onPanelWidth(SIDEBAR_WIDTH_MIN);
      else applyDrag(shown, step, false);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (!collapsed) onPanelWidth(shown - step);
    } else if (event.key === "Home") {
      event.preventDefault();
      onPanelWidth(SIDEBAR_WIDTH_MIN);
    } else if (event.key === "End") {
      event.preventDefault();
      onPanelWidth(SIDEBAR_WIDTH_MAX);
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={collapsed ? SIDEBAR_RAIL_WIDTH : SIDEBAR_WIDTH_MIN}
      aria-valuemax={max}
      aria-valuenow={shown}
      tabIndex={0}
      className="aq-side-resize"
      title="Drag to resize the sidebar. Double-click to reset the width."
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
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
  const personal = isPersonalShortcutKey(node.key);
  const row = useSidebarRow(personal ? "" : node.key, true);
  return (
    <div className={clsx("aq-nav-group", nested && "aq-nav-nested")}>
      <div className={clsx("aq-nav-link aq-nav-folder", active && !node.path && "active", !personal && row.dropClass)} onDragOver={personal ? undefined : row.onDragOver} onDragLeave={personal ? undefined : row.onDragLeave} onDrop={personal ? undefined : row.onDrop}>
        {personal ? null : <SidebarDragChrome itemKey={node.key} label={node.label} />}
        {node.path ? (
          <NavLink to={node.path} onClick={onNavigate} onMouseEnter={() => prefetchRoute(node.path!)} onFocus={() => prefetchRoute(node.path!)} className={() => clsx("aq-nav-folder-link", pathMatches(pathname, node.path!) && "active")} title={node.label}>
            <node.icon size={18} className="shrink-0" />
            <span className="aq-nav-label min-w-0 flex-1 truncate text-left">{node.label}</span>
          </NavLink>
        ) : (
          <button type="button" className="aq-nav-folder-link" onClick={onToggle} title={node.label}>
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

function SidebarDestination({ node, className, iconSize, onNavigate }: { node: SidebarLink; className: string; iconSize: number; onNavigate: () => void }) {
  const body = (
    <>
      <node.icon size={iconSize} className="shrink-0" />
      <span className="aq-nav-label min-w-0 flex-1 truncate">{node.label}</span>
    </>
  );
  if (sidebarLinkOpensNewTab(node)) {
    return (
      <a href={node.path} target="_blank" rel="noopener noreferrer" title={`${node.label} (opens in a new tab)`} className={className} onClick={onNavigate}>
        {body}
      </a>
    );
  }
  return (
    <NavLink to={node.path} title={node.label} onClick={onNavigate} onMouseEnter={() => prefetchRoute(node.path)} onFocus={() => prefetchRoute(node.path)} className={() => className}>
      {body}
    </NavLink>
  );
}

function LeafLink({ node, onNavigate, pathname }: { node: SidebarNode & { path: string }; onNavigate: () => void; pathname: string }) {
  const row = useSidebarRow(node.key, false);
  const organize = useSidebarOrganize();
  if (isFolder(node) || !node.path) return null;
  const active = pathMatches(pathname, node.path);
  if (!organize) {
    return <SidebarDestination node={node} iconSize={16} onNavigate={onNavigate} className={clsx("aq-nav-link aq-nav-child", active && "active")} />;
  }
  return (
    <div className={clsx("aq-nav-link aq-nav-folder aq-nav-child", active && "active", row.dropClass)} onDragOver={row.onDragOver} onDragLeave={row.onDragLeave} onDrop={row.onDrop}>
      <SidebarDragChrome itemKey={node.key} label={node.label} />
      <SidebarDestination node={node} iconSize={16} onNavigate={onNavigate} className={clsx("aq-nav-folder-link", active && "active")} />
    </div>
  );
}
