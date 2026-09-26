import { NavLink, Outlet, Link } from "react-router-dom";
import clsx from "clsx";
import { Users, ShieldCheck, Workflow, Bot, Truck, ClipboardCheck, PackageSearch, BarChart3, HeartPulse, Building2, FileCode2, Plug, AlertTriangle, KeyRound, DatabaseBackup, Factory, type LucideIcon } from "lucide-react";

interface ConsoleSection {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Nested path under /admin (rendered via Outlet, sidebar stays visible) */
  path?: string;
  /** A full page that already exists outside this console (Workflow Builder, Reporting Hub) — its own RBAC/layout needs the full page, not this sidebar competing for width, so this just navigates there instead of nesting it. */
  externalPath?: string;
  description: string;
}

const SECTIONS: ConsoleSection[] = [
  { key: "users", label: "Users & Roles", icon: Users, path: "users", description: "Create, edit, and deactivate users; assign system roles" },
  { key: "plants", label: "Plants", icon: Factory, path: "plants", description: "Add plants and choose who works at each one" },
  { key: "permissions", label: "Permissions", icon: ShieldCheck, path: "roles-permissions", description: "Department access, custom roles, and user-role assignments" },
  { key: "workflows", label: "Workflows", icon: Workflow, externalPath: "/workflow", description: "Edit workflow states, transitions, conditions, and actions" },
  { key: "ai", label: "AI Settings", icon: Bot, path: "ai-settings", description: "LLM provider, model, safety mode, and usage" },
  { key: "supplier", label: "Supplier Settings", icon: Truck, path: "supplier-settings", description: "Supplier quality risk score weighting" },
  { key: "quality", label: "Quality Settings", icon: ClipboardCheck, path: "quality-settings", description: "NCR auto-trigger and CAPA escalation rules" },
  { key: "receiving_inventory", label: "Receiving & Inventory", icon: PackageSearch, path: "receiving-inventory-settings", description: "Aging, lot/serial numbering, and cost rules" },
  // A full page, not nested in this narrow sidebar — same "externalPath"
  // treatment as Workflows/Reporting Settings below: the field-mapping
  // editor genuinely needs the width.
  { key: "erp_presets", label: "ERP Presets", icon: Plug, externalPath: "/erp/presets", description: "Vendor connector presets: field mappings, transforms, and validation rules for the ERP sync engine" },
  { key: "erp_errors", label: "ERP Sync Errors", icon: AlertTriangle, externalPath: "/erp/errors", description: "Mapping, validation, transform, trigger, and delivery failures from the ERP sync engine" },
  { key: "reporting", label: "Reporting Settings", icon: BarChart3, externalPath: "/reporting", description: "Scheduled reports and recipients" },
  { key: "system_health", label: "System Health", icon: HeartPulse, path: "system-health", description: "Cross-module diagnostics: AI, workflow, email, reporting, receiving, supplier portal, database" },
  { key: "api_docs", label: "API Reference", icon: FileCode2, path: "api-docs", description: "Interactive request/response docs generated from the app's own validation schemas" },
  { key: "sso", label: "Single Sign-On", icon: KeyRound, path: "sso", description: "Sign in with your company identity provider (OpenID Connect): domains, provider, and rules" },
  { key: "data_export", label: "Data Export", icon: DatabaseBackup, path: "data-export", description: "Download everything your organization keeps in AccuQual as a ZIP" },
  { key: "company", label: "Company Settings", icon: Building2, path: "company-settings", description: "Organization name, logo, timezone, and contact info" },
];

export { SECTIONS as ADMIN_CONSOLE_SECTIONS };

/**
 * Phase 10 — the "Platform Admin Console" the roadmap asks for. Deliberately
 * NOT the same thing as the pre-existing /platform page (that's a different,
 * SaaS-operator tool — company provisioning + a AI
 * overview, gated to the special platform_admin role). This shell is for a
 * COMPANY's own admin configuring their own company, unifying navigation only:
 * each section below reuses its already-built, already-RBAC'd component
 * as-is (Roles & Permissions, the Supplier/Quality/Receiving-Inventory
 * settings panels, the AI config/usage pages, ...) — this layout imposes NO
 * blanket role gate of its own, because those real gates differ per section
 * (e.g. Receiving & Inventory writes are Production/Purchasing, not admin —
 * see settings.routes.ts) and a console-level gate would silently break
 * departments that already have real, correct write access today.
 */
export function AdminConsoleLayout() {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
      <nav className="flex shrink-0 flex-row gap-1 overflow-x-auto pb-2 lg:w-56 lg:flex-col lg:overflow-visible lg:pb-0 lg:border-r lg:border-border lg:pr-4">
        <div className="mb-1 hidden px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70 lg:block">Admin Console</div>
        {SECTIONS.map((section) =>
          section.externalPath ? (
            <Link
              key={section.key}
              to={section.externalPath}
              className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
              title={section.description}
            >
              <section.icon size={16} />
              <span>{section.label}</span>
            </Link>
          ) : (
            <NavLink
              key={section.key}
              to={`/admin/${section.path}`}
              title={section.description}
              className={({ isActive }) =>
                clsx(
                  "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm",
                  isActive ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted"
                )
              }
            >
              <section.icon size={16} />
              <span>{section.label}</span>
            </NavLink>
          )
        )}
      </nav>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
