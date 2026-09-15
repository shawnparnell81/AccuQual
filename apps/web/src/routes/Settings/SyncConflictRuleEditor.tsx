import { SelectField } from "../../components/forms/Field";
import type { ErpSyncSettings } from "../../api/types";

type Strategy = NonNullable<ErpSyncSettings["conflictRules"]["resolutionStrategy"]>;

/** erpSyncSettings.conflictRules — how a sync should resolve a record that changed on both sides since the last run. */
export function SyncConflictRuleEditor({ value, onChange }: { value: Strategy | undefined; onChange: (value: Strategy) => void }) {
  return (
    <SelectField label="Conflict Resolution" value={value ?? "manual_review"} onChange={(e) => onChange(e.target.value as Strategy)}>
      <option value="local_wins">AccuQual wins</option>
      <option value="remote_wins">External system wins</option>
      <option value="manual_review">Flag for manual review</option>
    </SelectField>
  );
}
