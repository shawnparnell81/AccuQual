import { ImportButton } from "../../components/import/ImportDialog";
import { SecurityRolesSection } from "../Settings/SecurityRolesSection";

/** Reuses SecurityRolesSection as-is (moved out of the generic Settings page into the Admin Console — see SettingsPage.tsx's own note on this move) — its own admin/quality_manager gate is unchanged, not replaced by a console-level gate. */
export function AdminUsersRolesPage() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Users &amp; Roles</h1>
          <p className="text-sm text-muted-foreground">Create and manage users, and the coarse system roles (admin, quality_manager, ...) they hold.</p>
        </div>
        <ImportButton entity="people" />
      </div>
      <SecurityRolesSection />
    </div>
  );
}
