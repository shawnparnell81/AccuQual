import { useState } from "react";
import { Link } from "react-router-dom";
import { useCurrentUser } from "../../hooks/useAuth";
import { NavigationSettingsPage } from "./NavigationSettingsPage";
import { ThemeSettingsSection } from "./ThemeSettingsSection";
import { MfaSettingsSection, TrustedDevicesSection } from "./MfaSettingsSection";
import { ChangePasswordSection } from "./ChangePasswordSection";
import { FeasibilitySettingsPanel } from "./FeasibilitySettingsPanel";
import { NotificationPreferencesSection } from "./NotificationPreferencesSection";

const TABS = ["User Preferences", "Company", "Security", "Theme", "Notifications", "Email Alerts", "Feasibility", "Navigation"] as const;
type Tab = (typeof TABS)[number];

const COMPANY_LINKS = [
  { to: "/admin/company-settings", title: "Company name and logo", detail: "The name people see, the logo, timezone, and contact info." },
  { to: "/admin/company-branding", title: "Branding", detail: "Colors and the header used on exported documents." },
  { to: "/admin/users", title: "Users and roles", detail: "Add people, set their role, and turn an account off." },
  { to: "/admin/roles-permissions", title: "Departments and permissions", detail: "Which department can see or change each module." },
  { to: "/admin/plants", title: "Plants", detail: "Sites, and who works at each one." },
  { to: "/admin/receiving-inventory-settings", title: "Numbering formats", detail: "Lot and serial number formats, plus receiving and inventory rules." },
] as const;

/** Company setup that used to be easy to miss. These open the same admin screens; nothing here is a second copy of the data. */
function CompanySettingsLinks() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">These are the company settings. Each one opens the screen that already stores that information.</p>
      <ul className="flex flex-col gap-2">
        {COMPANY_LINKS.map((item) => (
          <li key={item.to}>
            <Link to={item.to} className="block rounded-lg border border-border bg-card p-4 hover:bg-muted/40">
              <p className="text-sm font-medium">{item.title}</p>
              <p className="text-sm text-muted-foreground">{item.detail}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * General app settings. Notifications and email alerts are real per-user
 * switches. Email delivery itself is the company's mail connection.
 */
export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("User Preferences");
  const user = useCurrentUser();

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
              <dd className="capitalize">{user?.department && user.department !== "sales_and_marketing" ? user.department.replace(/_/g, " ") : "—"}</dd>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              Name, role, and department, along with every other organization-wide setting (users &amp; roles, permissions, AI, supplier/quality/receiving settings, company profile), are managed in the{" "}
              <Link to="/admin" className="text-accent hover:underline">
                Admin Console
              </Link>
              .
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-medium">Navigation</h3>
            <p className="text-sm text-muted-foreground">
              The sidebar folders are fixed.{" "}
              <button onClick={() => setTab("Navigation")} className="text-accent hover:underline">
                See how the menu works
              </button>
              .
            </p>
          </div>
        </div>
      )}

      {tab === "Company" && <CompanySettingsLinks />}
      {tab === "Security" && (
        <div className="flex flex-col gap-4">
          <MfaSettingsSection />
          <TrustedDevicesSection />
          <ChangePasswordSection />
        </div>
      )}
      {tab === "Theme" && <ThemeSettingsSection />}

      {tab === "Notifications" && <NotificationPreferencesSection mode="inApp" />}
      {tab === "Email Alerts" && <NotificationPreferencesSection mode="email" />}
      {tab === "Feasibility" && <FeasibilitySettingsPanel />}

      {tab === "Navigation" && <NavigationSettingsPage />}
    </div>
  );
}
