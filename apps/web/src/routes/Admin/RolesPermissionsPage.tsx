import { useState } from "react";
import { AdminOnlyGuard } from "../../components/shared/AdminOnlyGuard";
import { PermissionsDepartmentAccessTab } from "./PermissionsDepartmentAccessTab";
import { PermissionsRolesTab } from "./PermissionsRolesTab";
import { PermissionsUserAssignmentsTab } from "./PermissionsUserAssignmentsTab";

const TABS = [
  { key: "department_access", label: "Department Access" },
  { key: "roles", label: "Roles" },
  { key: "users", label: "User Assignments" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/**
 * The self-service Roles & Permissions module — replaces the hardcoded
 * PERMISSION_MATRIX in departmentAccess.ts with real, tenant-configurable
 * rows (department_permissions / permission_roles / permission_role_modules
 * / user_permission_roles), enforced live on every request by
 * getUserAccessLevel. See that file's own comment for the full design.
 */
export function RolesPermissionsPage() {
  const [tab, setTab] = useState<TabKey>("department_access");

  return (
    <AdminOnlyGuard>
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Roles &amp; Permissions</h1>
          <p className="text-sm text-muted-foreground">
            Configure which departments can access each module, define custom roles with their own module grants, and assign users to
            departments and roles — no code change or deploy required.
          </p>
        </div>

        <div className="flex gap-1 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-t-md px-3 py-2 text-sm ${tab === t.key ? "border-b-2 border-primary font-medium text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "department_access" && <PermissionsDepartmentAccessTab />}
        {tab === "roles" && <PermissionsRolesTab />}
        {tab === "users" && <PermissionsUserAssignmentsTab />}
      </div>
    </AdminOnlyGuard>
  );
}
