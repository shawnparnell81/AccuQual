import { Suspense } from "react";
import { NavLink, Outlet, Link } from "react-router-dom";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import clsx from "clsx";
import { Users, ShieldCheck, Workflow, Bot, Truck, ClipboardCheck, PackageSearch, BarChart3, HeartPulse, Building2, FileCode2, KeyRound, DatabaseBackup, Factory, Upload, History, Boxes, type LucideIcon } from "lucide-react";
import { useDigitalTwinEnabled } from "../../hooks/useDigitalTwinEnabled";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { useCurrentUser } from "../../hooks/useAuth";
import { isFullAccessRole } from "../../lib/fullAccess";
import { UnsavedDot } from "../../components/layout/sectionDraft";

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
  { key: "digital_twin", label: "Digital Twin Setup", icon: Boxes, path: "digital-twin", description: "Models, machines, and device keys for a production line" },
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

function permissionOn(effective: Record<string, string> | undefined, key: string): boolean {
  const level = effective?.[key];
  return level === "read" || level === "edit";
}

/** Sections this person may open. Import data follows the import permission. Other sections stay with Owner and Administrator. */
export function useAdminConsoleSections(): ConsoleSection[] {
  const user = useCurrentUser();
  const admin = isFullAccessRole(user?.roleName);
  const { effective, isLoading } = useEffectivePermissions();
  const { enabled: digitalTwin } = useDigitalTwinEnabled();
  return SECTIONS.filter((section) => {
    if (section.key === "digital_twin" && !digitalTwin) return false;
    if (section.key === "import") {
      if (admin) return true;
      if (isLoading || !effective) return false;
      return permissionOn(effective, "import_data");
    }
    if (!admin) return false;
    if (!section.permission) return true;
    if (isLoading || !effective) return false;
    return permissionOn(effective, section.permission);
  });
}

/**
 * Company admin pages. The top bar is the only sidebar. These sections are a
 * compact strip under that header, and the page itself uses the full width.
 * Sections keep their own access checks (settings.routes.ts).
 */
export function AdminConsoleLayout() {
  const sections = useAdminConsoleSections();

  return (
    <div className="flex min-w-0 w-full max-w-none flex-col gap-4">
      <nav id="admin-console-nav" aria-label="Admin" className="flex gap-1 overflow-x-auto border-b border-border pb-2">
        {sections.map((section) => {
          const className = ({ isActive }: { isActive: boolean }) =>
            clsx(
              "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs",
              isActive ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            );
          const body = (
            <>
              <section.icon size={14} className="shrink-0" />
              <span>{section.label}</span>
              {section.path ? <UnsavedDot path={`/admin/${section.path}`} /> : null}
            </>
          );
          return section.externalPath ? (
            <Link key={section.key} to={section.externalPath} title={section.description} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
              {body}
            </Link>
          ) : (
            <NavLink key={section.key} to={`/admin/${section.path}`} title={section.description} className={className}>
              {body}
            </NavLink>
          );
        })}
      </nav>
      <div className="min-w-0 w-full max-w-none">
        <Suspense fallback={<LoadingPlaceholder />}>
          <Outlet />
        </Suspense>
      </div>
    </div>
  );
}
