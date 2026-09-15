import { useState } from "react";
import { Link } from "react-router-dom";
import { useCurrentUser, useCurrentTenant } from "../../hooks/useAuth";
import { NavigationSettingsPage } from "./NavigationSettingsPage";
import { SecurityRolesSection } from "./SecurityRolesSection";
import { ThemeSettingsSection } from "./ThemeSettingsSection";
import { FeasibilitySettingsPanel } from "./FeasibilitySettingsPanel";
import { InventoryAdvancedSettingsPanel } from "./InventoryAdvancedSettingsPanel";
import { ERPSyncSettingsPanel } from "./ERPSyncSettingsPanel";

const TABS = [
  "User Preferences",
  "Theme",
  "Notifications",
  "Email Alerts",
  "ERP Integration",
  "Inventory Settings",
  "Feasibility",
  "Security & Roles",
  "Tenant Settings",
  "Navigation",
] as const;
type Tab = (typeof TABS)[number];

/** A section of this page with nothing behind it yet — shown plainly rather than as a working-looking toggle that does nothing. */
function NotAvailable({ what }: { what: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
      {what} isn't available yet — there's no {what.toLowerCase()} system built into AccuQual to configure. This section is a placeholder
      until that exists, rather than a control that would silently do nothing.
    </div>
  );
}

/**
 * General app settings — distinct from /settings/navigation ("Customize
 * Navigation"), which is a real, separate, already-shipped feature for
 * hiding department dropdowns, not a bug and not replaced here. That page
 * is folded in as this page's "Navigation" tab so there's one Settings
 * entry point instead of two unrelated ones; its own URL still works.
 *
 * Every tab here is either real (backed by an existing endpoint —
 * Security & Roles uses GET/POST/PATCH/DELETE /users and GET/POST/PATCH
 * /roles, both real and previously unused by any frontend page) or an
 * explicit "not available" placeholder — nothing here is a toggle that
 * looks functional but silently does nothing.
 */
export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("User Preferences");
  const user = useCurrentUser();
  const tenant = useCurrentTenant();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`whitespace-nowrap px-3 py-2 text-sm ${tab === t ? "border-b-2 border-primary font-medium text-primary" : "text-muted-foreground"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "User Preferences" && (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-medium">Your Account</h3>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Name</dt>
              <dd>{user?.name ?? "—"}</dd>
              <dt className="text-muted-foreground">Email</dt>
              <dd>{user?.email ?? "—"}</dd>
              <dt className="text-muted-foreground">Role</dt>
              <dd className="capitalize">{user?.roleName?.replace(/_/g, " ") ?? "—"}</dd>
              <dt className="text-muted-foreground">Department</dt>
              <dd className="capitalize">{user?.department ?? "—"}</dd>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              Name, role, and department are managed by a tenant admin — see the{" "}
              <button onClick={() => setTab("Security & Roles")} className="text-primary hover:underline">
                Security &amp; Roles
              </button>{" "}
              tab.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-medium">Navigation</h3>
            <p className="text-sm text-muted-foreground">
              Which department dropdowns and modules show up in the top nav is its own real setting —{" "}
              <button onClick={() => setTab("Navigation")} className="text-primary hover:underline">
                open the Navigation tab
              </button>
              .
            </p>
          </div>
        </div>
      )}

      {tab === "Theme" && <ThemeSettingsSection />}

      {tab === "Notifications" && <NotAvailable what="Notifications" />}
      {tab === "Email Alerts" && <NotAvailable what="Email delivery" />}
      {tab === "ERP Integration" && <ERPSyncSettingsPanel />}
      {tab === "Inventory Settings" && <InventoryAdvancedSettingsPanel />}
      {tab === "Feasibility" && <FeasibilitySettingsPanel />}

      {tab === "Security & Roles" && <SecurityRolesSection />}

      {tab === "Tenant Settings" && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">Your Organization</h3>
          {tenant ? (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Name</dt>
              <dd>{tenant.name}</dd>
              <dt className="text-muted-foreground">Tenant code</dt>
              <dd className="font-mono">{tenant.code}</dd>
              <dt className="text-muted-foreground">Branding</dt>
              <dd className="text-muted-foreground">{tenant.branding?.primaryColor ? `Primary color ${tenant.branding.primaryColor}` : "Using defaults"}</dd>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No tenant context on this account (platform admin accounts aren't scoped to one).</p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Read-only here — organization branding and tenant-level settings are managed through{" "}
            <Link to="/platform" className="text-primary hover:underline">
              Platform Administration
            </Link>
            , not by individual tenant users.
          </p>
        </div>
      )}

      {tab === "Navigation" && <NavigationSettingsPage />}
    </div>
  );
}
