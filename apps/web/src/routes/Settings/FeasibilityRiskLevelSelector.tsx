import { SelectField } from "../../components/forms/Field";
import type { FeasibilityRiskLevel } from "../../api/types";

const RISK_LEVELS: FeasibilityRiskLevel[] = ["low", "medium", "high", "critical"];

/** A plain, reusable risk-level <select> — used by FeasibilitySettingsPanel for defaultRiskLevel, and reusable wherever else a feasibility riskLevel needs picking (e.g. a future record-level override control). */
export function FeasibilityRiskLevelSelector({ value, onChange }: { value: FeasibilityRiskLevel | undefined; onChange: (value: FeasibilityRiskLevel) => void }) {
  return (
    <SelectField label="Default Risk Level" value={value ?? "medium"} onChange={(e) => onChange(e.target.value as FeasibilityRiskLevel)}>
      {RISK_LEVELS.map((level) => (
        <option key={level} value={level} className="capitalize">
          {level[0]!.toUpperCase() + level.slice(1)}
        </option>
      ))}
    </SelectField>
  );
}
