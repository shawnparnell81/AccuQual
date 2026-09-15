const MODULES: { value: string; label: string }[] = [
  { value: "inventory", label: "Inventory" },
  { value: "suppliers", label: "Suppliers" },
  { value: "purchaseOrders", label: "Purchase Orders" },
  { value: "workOrders", label: "Work Orders" },
];

/** erpSyncSettings.modulesEnabled — which real AccuQual modules a triggered sync includes in its webhook payload. */
export function SyncModuleSelector({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  function toggle(mod: string) {
    onChange(value.includes(mod) ? value.filter((m) => m !== mod) : [...value, mod]);
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Modules to Sync</span>
      <div className="flex flex-wrap gap-3">
        {MODULES.map((m) => (
          <label key={m.value} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={value.includes(m.value)} onChange={() => toggle(m.value)} className="h-4 w-4 rounded border-form-field" />
            <span>{m.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
