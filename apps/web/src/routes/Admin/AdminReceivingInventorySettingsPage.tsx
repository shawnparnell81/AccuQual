import { InventoryAdvancedSettingsPanel } from "../Settings/InventoryAdvancedSettingsPanel";

/**
 * Reuses InventoryAdvancedSettingsPanel as-is (moved out of the generic
 * Settings page). Write access is Production/Purchasing, not admin — see
 * settings.routes.ts — unchanged by this move: the console shell imposes no
 * gate of its own. Receiving's own workflow states (7-state disposition
 * flow) are fixed by design, not configurable here — see
 * receivingWorkflow.ts; the configurable NCR/CAPA-trigger rules that DO
 * exist for receiving live under this console's "Quality Settings" section.
 */
export function AdminReceivingInventorySettingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Receiving &amp; Inventory Settings</h1>
        <p className="text-sm text-muted-foreground">
          Aging thresholds, reservation rules, lot/serial number formats, and cost adjustment rules. NCR/CAPA auto-trigger rules for
          receiving live under Quality Settings.
        </p>
      </div>
      <InventoryAdvancedSettingsPanel />
    </div>
  );
}
