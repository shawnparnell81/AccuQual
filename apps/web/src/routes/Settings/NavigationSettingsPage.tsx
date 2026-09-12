import { NAV_STRUCTURE, DEPARTMENTS, SYSTEM_LABEL } from "../../components/layout/navConfig";
import { departmentScope, itemScope, useHiddenNavScopes, useSetNavScopeHidden } from "../../hooks/useNavPreferences";

/**
 * "The user can add or remove tabs as needed for their processes" — applied
 * to the main nav (Document Library already has its own, separate way to do
 * this via the Folder Explorer's delete buttons). The catalog here is fixed
 * app code, so "remove" is really "hide", and "add back" is just un-hiding —
 * nothing is ever actually deleted, so every toggle is safely reversible.
 */
export function NavigationSettingsPage() {
  const hiddenScopes = useHiddenNavScopes();
  const hidden = new Set(hiddenScopes);
  const setHidden = useSetNavScopeHidden();

  function isHidden(scope: string) {
    return hidden.has(scope);
  }
  function toggle(scope: string, currentlyHidden: boolean) {
    setHidden.mutate({ scope, hidden: !currentlyHidden });
  }

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Customize Navigation</h1>
        <p className="text-sm text-muted-foreground">
          Hide the departments or modules your team doesn't use. Nothing is deleted — flip it back on any time.
        </p>
      </div>

      {NAV_STRUCTURE.map((group) => {
        const groupKey = group.department ?? "system";
        const meta = DEPARTMENTS.find((d) => d.key === group.department);
        const label = meta?.label ?? SYSTEM_LABEL;
        const deptScope = departmentScope(groupKey);
        const deptHidden = isHidden(deptScope);

        return (
          <section key={groupKey} className={`rounded-lg border bg-card transition-opacity ${deptHidden ? "border-border opacity-60" : "border-border"}`}>
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              {meta && <meta.icon size={18} className={meta.text} />}
              <h2 className="flex-1 text-sm font-semibold">{label}</h2>
              <ToggleSwitch checked={!deptHidden} onChange={() => toggle(deptScope, deptHidden)} label={`Show the ${label} dropdown`} />
            </div>
            <div className="flex flex-col divide-y divide-border">
              {group.items.map((item) => {
                const scope = itemScope(groupKey, item.key);
                const itemHidden = isHidden(scope);
                return (
                  <div key={item.key} className="flex items-center gap-3 px-4 py-2 pl-10">
                    <item.icon size={15} className="text-muted-foreground" />
                    <span className="flex-1 text-sm text-muted-foreground">{item.label}</span>
                    <ToggleSwitch checked={!itemHidden && !deptHidden} disabled={deptHidden} onChange={() => toggle(scope, itemHidden)} label={`Show ${item.label}`} />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ToggleSwitch({ checked, onChange, disabled, label }: { checked: boolean; onChange: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-5 w-9 flex-none rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-primary" : "bg-muted"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-background transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`}
      />
    </button>
  );
}
