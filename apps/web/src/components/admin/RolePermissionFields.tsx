import { useEffect, useRef } from "react";
import { useConfirm } from "../shared/ConfirmDialog";
import {
  ALL_PERMISSIONS_CONFIRM,
  ROLE_PERMISSION_GROUPS,
  allRolePermissionKeys,
  permissionCheckState,
  setPermissionKeys,
  type PermissionCheckState,
} from "../../lib/rolePermissionSelection";

function TriStateCheckbox({
  state,
  label,
  ariaLabel,
  onChange,
}: {
  state: PermissionCheckState;
  label: string;
  ariaLabel?: string;
  onChange: (on: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "partial";
  }, [state]);
  return (
    <label className="flex items-center gap-2">
      <input ref={ref} type="checkbox" aria-label={ariaLabel ?? label} checked={state === "all"} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

/** Checkboxes for the permissions stored on a role. All permissions and each section can be set together. */
export function RolePermissionFields({ selected, onChange }: { selected: string[]; onChange: (next: string[]) => void }) {
  const confirm = useConfirm();
  const allKeys = allRolePermissionKeys();

  async function setAll(on: boolean) {
    if (!on) {
      onChange(setPermissionKeys(selected, allKeys, false));
      return;
    }
    if (permissionCheckState(selected, allKeys) === "all") return;
    const ok = await confirm({
      title: "Grant every permission?",
      message: ALL_PERMISSIONS_CONFIRM,
      confirmLabel: "Continue",
    });
    if (ok) onChange(setPermissionKeys(selected, allKeys, true));
  }

  return (
    <div className="flex flex-col gap-3">
      <TriStateCheckbox state={permissionCheckState(selected, allKeys)} label="All permissions" onChange={(on) => void setAll(on)} />
      {ROLE_PERMISSION_GROUPS.map((group) => {
        const keys = group.permissions.map((item) => item.key);
        return (
          <fieldset key={group.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <legend className="text-xs font-medium text-foreground">{group.label}</legend>
              <span className="text-xs text-muted-foreground">
                <TriStateCheckbox
                  state={permissionCheckState(selected, keys)}
                  label="Select all"
                  ariaLabel={`Select all ${group.label}`}
                  onChange={(on) => onChange(setPermissionKeys(selected, keys, on))}
                />
              </span>
            </div>
            {group.permissions.map((item) => (
              <div key={item.key}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(item.key)}
                    onChange={(event) => onChange(setPermissionKeys(selected, [item.key], event.target.checked))}
                  />
                  {item.label}
                </label>
                {item.hint ? <p className="ml-6 text-xs text-muted-foreground">{item.hint}</p> : null}
              </div>
            ))}
          </fieldset>
        );
      })}
    </div>
  );
}
