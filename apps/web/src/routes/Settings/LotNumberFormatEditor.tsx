import { TextField } from "../../components/forms/Field";

/** inventorySettings.autoGenerateLotNumbers + lotNumberFormat — see inventory.service.ts's generateTrackingNumber for the token substitution this format string drives. */
export function LotNumberFormatEditor({
  enabled,
  format,
  onChangeEnabled,
  onChangeFormat,
}: {
  enabled: boolean;
  format: string;
  onChangeEnabled: (enabled: boolean) => void;
  onChangeFormat: (format: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => onChangeEnabled(e.target.checked)} className="h-4 w-4 rounded border-form-field" />
        <span>Auto-generate Lot Numbers on receive/produce</span>
      </label>
      <TextField label="Lot Number Format" value={format} onChange={(e) => onChangeFormat(e.target.value)} disabled={!enabled} placeholder="LOT-{YYYY}{MM}{DD}-{SEQ}" />
      <p className="text-xs text-muted-foreground">Tokens: {"{SKU} {YYYY} {MM} {DD} {SEQ}"} — SEQ is a 4-digit running count per item.</p>
    </div>
  );
}
