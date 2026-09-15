/** inventorySettings.agingRules — drives the agingBucket ("fresh"/"warning"/"critical") computed live on every inventory item, see inventory.service.ts's computeAgingBucket. */
export function InventoryAgingRuleEditor({
  warningDays,
  criticalDays,
  onChange,
}: {
  warningDays: number | undefined;
  criticalDays: number | undefined;
  onChange: (rules: { warningDays?: number; criticalDays?: number }) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Aging Thresholds</span>
      <p className="text-xs text-muted-foreground">Days since an item's stock last moved before it's flagged.</p>
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="text-warning">Warning at (days)</span>
          <input
            type="number"
            min={0}
            value={warningDays ?? ""}
            onChange={(e) => onChange({ warningDays: e.target.value ? Number(e.target.value) : undefined, criticalDays })}
            className="w-full rounded-md border border-form-field bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="text-destructive">Critical at (days)</span>
          <input
            type="number"
            min={0}
            value={criticalDays ?? ""}
            onChange={(e) => onChange({ warningDays, criticalDays: e.target.value ? Number(e.target.value) : undefined })}
            className="w-full rounded-md border border-form-field bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
      </div>
    </div>
  );
}
