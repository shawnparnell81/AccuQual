import { Suspense, useState } from "react";
import { NavLink, Outlet, Link } from "react-router-dom";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import clsx from "clsx";
import { Users, ShieldCheck, Workflow, Bot, Truck, ClipboardCheck, PackageSearch, BarChart3, HeartPulse, Building2, FileCode2, KeyRound, DatabaseBackup, Factory, Upload, History, PanelLeftClose, PanelLeftOpen, type LucideIcon } from "lucide-react";
import { readAdminNavCollapsed, writeAdminNavCollapsed } from "../../lib/adminNavCollapsed";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";

interface ConsoleSection {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Nested path under /admin (rendered via Outlet, sidebar stays visible) */
  path?: string;
  /** A full page that already exists outside this console (Workflow Builder, Reporting Hub) — its own RBAC/layout needs the full page, not this sidebar competing for width, so this just navigates there instead of nesting it. */
  externalPath?: string;
  description: string;
  /** Shown only when GET /permissions/effective grants this role permission. */
  permission?: string;
}

const SECTIONS: ConsoleSection[] = [
  { key: "users", label: "Users & Roles", icon: Users, path: "users", description: "Create, edit, and remove users; assign system roles" },
  { key: "import", label: "Import data", icon: Upload, path: "import", description: "Load suppliers, parts, inspections, and other records from a spreadsheet" },
  { key: "plants", label: "Plants", icon: Factory, path: "plants", description: "Add plants and choose who works at each one" },
  { key: "permissions", label: "Permissions", icon: ShieldCheck, path: "roles-permissions", description: "System roles, department access, and who is assigned" },
  { key: "login_history", label: "Login History", icon: History, path: "login-history", description: "Who signed in, when, from where, and on what device", permission: "login_history" },
  { key: "workflows", label: "Workflows", icon: Workflow, externalPath: "/workflow", description: "Edit workflow states, transitions, conditions, and actions" },
  { key: "ai", label: "AI Settings", icon: Bot, path: "ai-settings", description: "LLM provider, model, safety mode, and usage" },
  { key: "supplier", label: "Supplier Settings", icon: Truck, path: "supplier-settings", description: "Supplier quality risk score weighting" },
  { key: "quality", label: "Quality Settings", icon: ClipboardCheck, path: "quality-settings", description: "Due reminders, repeat NCRs, and receiving escalation" },
  { key: "receiving_inventory", label: "Receiving & Inventory", icon: PackageSearch, path: "receiving-inventory-settings", description: "Aging, lot/serial numbering, and cost rules" },
  // A full page, not nested in this narrow sidebar — same "externalPath"
  // treatment as Workflows/Reporting Settings below: the field-mapping
  // editor genuinely needs the width.
  { key: "reporting", label: "Reporting Settings", icon: BarChart3, externalPath: "/reporting", description: "Scheduled reports and recipients" },
  { key: "system_health", label: "System Health", icon: HeartPulse, path: "system-health", description: "Cross-module diagnostics: AI, workflow, email, reporting, receiving, supplier portal, database" },
  { key: "api_docs", label: "API Reference", icon: FileCode2, path: "api-docs", description: "Interactive request/response docs generated from the app's own validation schemas" },
  { key: "sso", label: "Single Sign-On", icon: KeyRound, path: "sso", description: "Sign in with your company identity provider (OpenID Connect): domains, provider, and rules" },
  { key: "data_export", label: "Data Export", icon: DatabaseBackup, path: "data-export", description: "Download everything your organization keeps in AccuQual as a ZIP" },
  { key: "company", label: "Company Settings", icon: Building2, path: "company-settings", description: "Organization name, logo, timezone, and contact info" },
];

export { SECTIONS as ADMIN_CONSOLE_SECTIONS };

/** Sections this person may open. Login History follows the role permission, which an administrator assigns. */
export function useAdminConsoleSections(): ConsoleSection[] {
  const { effective, isLoading } = useEffectivePermissions();
  return SECTIONS.filter((section) => {
    if (!section.permission) return true;
    if (isLoading || !effective) return false;
    const level = effective[section.permission];
    return level === "read" || level === "edit";
  });
}

/**
 * Company admin navigation. Not the old /platform operator page.
 * Sections keep their own access checks (settings.routes.ts). A gate on this layout would block departments that can already write.
 */
function readCollapsed(): boolean {
  try {
    return readAdminNavCollapsed(window.sessionStorage);
  } catch {
    return false;
  }
}

export function AdminConsoleLayout() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const sections = useAdminConsoleSections();

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      try {
        writeAdminNavCollapsed(window.sessionStorage, next);
      } catch {
        // The menu still opens and closes for this visit.
      }
      return next;
    });
  }

  return (
    <div className={clsx("flex min-w-0 max-w-full gap-4", collapsed ? "flex-col" : "flex-col lg:flex-row lg:items-start lg:gap-6")}>
      <div className={clsx("min-w-0 shrink-0", !collapsed && "lg:w-56 lg:border-r lg:border-border lg:pr-4")}>
        <button
          type="button"
          data-testid="admin-nav-toggle"
          aria-expanded={!collapsed}
          aria-controls="admin-console-nav"
          onClick={toggleCollapsed}
          className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          {collapsed ? "Show admin menu" : "Hide admin menu"}
        </button>
        <nav id="admin-console-nav" aria-label="Admin console" hidden={collapsed} className="flex flex-row flex-wrap gap-1 lg:flex-col lg:flex-nowrap">
          <div className="mb-1 hidden px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70 lg:block">Admin Console</div>
          {sections.map((section) =>
            section.externalPath ? (
              <Link
                key={section.key}
                to={section.externalPath}
                className="flex min-w-0 items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
                title={section.description}
              >
                <section.icon size={16} className="shrink-0" />
                <span className="min-w-0">{section.label}</span>
              </Link>
            ) : (
              <NavLink
                key={section.key}
                to={`/admin/${section.path}`}
                title={section.description}
                className={({ isActive }) =>
                  clsx(
                    "flex min-w-0 items-center gap-2 rounded-md px-3 py-2 text-sm",
                    isActive ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted"
                  )
                }
              >
                <section.icon size={16} className="shrink-0" />
                <span className="min-w-0">{section.label}</span>
              </NavLink>
            )
          )}
        </nav>
      </div>
      <div className="min-w-0 w-full flex-1">
        <Suspense fallback={<LoadingPlaceholder />}>
          <Outlet />
        </Suspense>
      </div>
    </div>
  );
}
