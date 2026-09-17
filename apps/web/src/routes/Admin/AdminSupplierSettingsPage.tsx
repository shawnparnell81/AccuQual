import { SupplierRiskSettingsPanel } from "../Settings/SupplierRiskSettingsPanel";

/** Reuses SupplierRiskSettingsPanel as-is (moved out of the generic Settings page — see SettingsPage.tsx's own note). Write access is Quality-only, read is open to any department that can see supplier records at all (settings.routes.ts) — unchanged by this move. */
export function AdminSupplierSettingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Supplier Settings</h1>
        <p className="text-sm text-muted-foreground">Weighting for the Supplier Quality Risk Score's factors.</p>
      </div>
      <SupplierRiskSettingsPanel />
    </div>
  );
}
