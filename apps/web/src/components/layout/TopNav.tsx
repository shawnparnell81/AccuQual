import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Building2, ChevronDown, Lock, Menu, Search, X } from "lucide-react";
import { apiClient } from "../../api/client";
import { useCurrentTenant, useCurrentUser } from "../../hooks/useAuth";
import {
  DASHBOARD_LEAF,
  DEPARTMENTS,
  KPI_COUNT_KEYS,
  NAV_STRUCTURE,
  PLATFORM_LEAF,
  SYSTEM_LABEL,
  type AccessLevel,
  type Department,
  type DepartmentMeta,
  type NavLeaf,
} from "./navConfig";

type KpiCounts = Partial<Record<(typeof KPI_COUNT_KEYS)[number], number>>;
type DropdownId = Department | "system";

// How long the cursor may be off a dropdown (moving from the trigger down into
// the panel briefly leaves both) before it auto-closes. Long enough that the
// hand-off doesn't flicker, short enough that it still feels like "closes when
// you move off it".
const CLOSE_GRACE_MS = 150;

function useKpiCounts() {
  const { data } = useQuery({
    queryKey: ["nav-kpi-counts"],
    queryFn: async () => (await apiClient.get<KpiCounts>("/nav/kpi-counts")).data,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return data ?? {};
}

/** Read/write access this viewer has on a leaf, given which dropdown it's being shown in. */
function effectiveAccess(leaf: NavLeaf, department: Department, bypass: boolean): AccessLevel {
  if (bypass) return leaf.access[department] ? "edit" : "none";
  return leaf.access[department] ?? "none";
}

export function TopNav() {
  const tenant = useCurrentTenant();
  const user = useCurrentUser();
  const isPlatformAdmin = user?.roleName === "platform_admin";
  const isAdmin = user?.roleName === "admin";
  const userDept = user?.department as Department | null | undefined;
  const kpiCounts = useKpiCounts();

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

  // Which department groups this viewer gets a dropdown for at all.
  const visibleGroups = useMemo(
    () =>
      NAV_STRUCTURE.filter((g) => g.department === null || isAdmin || isPlatformAdmin || g.department === userDept),
    [isAdmin, isPlatformAdmin, userDept]
  );

  const systemGroup = visibleGroups.find((g) => g.department === null);
  const departmentGroups = visibleGroups.filter((g) => g.department !== null);

  const allVisibleLeaves = useMemo(() => {
    const seen = new Set<string>();
    const out: NavLeaf[] = [];
    for (const g of visibleGroups) {
      for (const item of g.items) {
        if (seen.has(item.key)) continue;
        seen.add(item.key);
        out.push(item);
      }
    }
    return out;
  }, [visibleGroups]);

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
      <div className="h-14 flex items-center gap-3 px-4">
        <BrandMark tenant={tenant} />

        {/* Desktop mega-menu */}
        <nav className="hidden md:flex flex-1 items-center gap-1 min-w-0">
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
            const items = [...group.items].sort((a, b) => a.priority - b.priority);
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
              {systemGroup.items.map((item) => (
                <Link
                  key={item.key}
                  to={item.path}
                  title={item.notes}
                  onClick={() => setOpenId(null)}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted whitespace-nowrap"
                >
                  <item.icon size={16} />
                  <span>{item.label}</span>
                </Link>
              ))}
            </NavDropdown>
          )}
        </nav>

        {/* Quick-nav search — client-side filter over the modules above; not yet
            wired to the Elasticsearch cluster (no search API exists for that today). */}
        <div className="relative hidden md:block w-52 shrink-0">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a module…"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
          {searchResults.length > 0 && (
            <div className="absolute right-0 top-full z-30 mt-1 w-64 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-card p-1 shadow-lg">
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
            </div>
          )}
        </div>

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
            searchResults.map((r) => (
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
            ))
          ) : (
            <>
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
                const items = [...group.items].sort((a, b) => a.priority - b.priority);
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
                      {systemGroup.items.map((item) => (
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
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </header>
  );
}

function BrandMark({ tenant }: { tenant: { name: string } | null }) {
  return (
    <div className="flex flex-col items-start justify-center shrink-0">
      <span className="font-semibold text-primary leading-tight">AccuQual</span>
      {tenant && <span className="text-xs text-muted-foreground leading-tight truncate max-w-[10rem]">{tenant.name}</span>}
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
        {meta && <meta.icon size={18} className={meta.text} />}
        <span>{label}</span>
        <ChevronDown size={14} className={clsx("transition-transform", isOpen && "rotate-180")} />
      </button>
      {isOpen && (
        <div
          ref={panelRef}
          className={clsx(
            "absolute top-full z-30 mt-1 min-w-[16rem] max-h-[70vh] overflow-y-auto rounded-md border border-border bg-card p-2 shadow-lg",
            twoColumn ? "grid grid-cols-2 gap-x-2" : "flex flex-col",
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
  kpiCounts,
  onNavigate,
}: {
  item: NavLeaf;
  department: Department;
  bypass: boolean;
  kpiCounts: KpiCounts;
  onNavigate: () => void;
}) {
  const level = effectiveAccess(item, department, bypass);
  if (level === "none") return null;
  const count = item.kpi ? kpiCounts[item.key as (typeof KPI_COUNT_KEYS)[number]] : undefined;

  return (
    <Link
      to={item.path}
      title={item.notes}
      onClick={onNavigate}
      className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted whitespace-nowrap"
    >
      <item.icon size={16} />
      <span className="flex-1">{item.label}</span>
      {level === "read" && <Lock size={12} className="text-muted-foreground" aria-label="Read-only for your department" />}
      {item.kpi &&
        (count !== undefined ? (
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary tabular-nums">{count}</span>
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="KPI dashboard item" />
        ))}
    </Link>
  );
}
