import { TextField } from "../../components/forms/Field";

/** inventorySettings.autoGenerateSerialNumbers + serialNumberFormat — same token substitution as LotNumberFormatEditor, via inventory.service.ts's generateTrackingNumber. */
export function SerialNumberFormatEditor({
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
        <span>Auto-generate Serial Numbers on receive/produce</span>
      </label>
      <TextField label="Serial Number Format" value={format} onChange={(e) => onChangeFormat(e.target.value)} disabled={!enabled} placeholder="{SKU}-SN-{SEQ}" />
      <p className="text-xs text-muted-foreground">Tokens: {"{SKU} {YYYY} {MM} {DD} {SEQ}"} — SEQ is a 4-digit running count per item.</p>
    </div>
  );
}
