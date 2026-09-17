import { ReceivingSettingsPanel } from "../Settings/ReceivingSettingsPanel";

/**
 * Labeled "Quality Settings" here — not "Receiving Settings" — because its
 * real content (autoCreateNcrOnRejection/OnQuarantine, defect-category
 * filter, capaEscalationThreshold/WindowDays) IS the NCR auto-trigger / CAPA
 * escalation configuration the roadmap calls "Quality Settings"; receiving's
 * own workflow states are fixed by design (see receivingWorkflow.ts), not
 * settings. Reuses ReceivingSettingsPanel as-is — same component, same
 * Quality-only write gate, just presented under its accurate name here
 * (still labeled "Receiving" in Settings' own tab, unchanged, since that URL
 * and its ERP/Feasibility siblings are out of this phase's scope).
 */
export function AdminQualitySettingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Quality Settings</h1>
        <p className="text-sm text-muted-foreground">NCR auto-trigger rules and CAPA escalation thresholds for receiving inspections.</p>
      </div>
      <ReceivingSettingsPanel />
    </div>
  );
}
