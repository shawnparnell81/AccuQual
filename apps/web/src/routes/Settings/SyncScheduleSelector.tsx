import { SelectField } from "../../components/forms/Field";
import type { ErpSyncSettings } from "../../api/types";

type Schedule = NonNullable<ErpSyncSettings["schedule"]>;

/**
 * erpSyncSettings.schedule — real stored config, but AccuQual has no
 * background scheduler (see settings.erpSync.ts's own comment), so "Hourly"/
 * "Daily" don't run themselves yet; a sync only actually happens via
 * "Trigger Sync Now" below. Kept honest rather than implying automation that
 * doesn't exist.
 */
export function SyncScheduleSelector({ value, onChange }: { value: Schedule | null | undefined; onChange: (value: Schedule) => void }) {
  return (
    <div>
      <SelectField label="Sync Schedule" value={value ?? "manual"} onChange={(e) => onChange(e.target.value as Schedule)}>
        <option value="manual">Manual only</option>
        <option value="hourly">Hourly</option>
        <option value="daily">Daily</option>
      </SelectField>
      {value && value !== "manual" && <p className="mt-1 text-xs text-muted-foreground">Stored for a future background worker — today, every sync still runs only when you click "Trigger Sync Now".</p>}
    </div>
  );
}
