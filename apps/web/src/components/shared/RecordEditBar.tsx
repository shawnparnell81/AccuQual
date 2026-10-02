import { useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { useMayEditEquipment } from "../calibration/EquipmentPanels";
import { useCurrentUser } from "../../hooks/useAuth";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { canMaintainMasterList } from "../../lib/masterListAccess";
import { recordSurface, type RecordSurface } from "../../lib/recordSurface";
import { focusFirstEditable } from "./GridClipboard";
import { RecordEditButton } from "./RecordEditButton";

let snapshot: Record<string, boolean> = {};
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

export function setRecordEditing(path: string, editing: boolean) {
  snapshot = { ...snapshot, [path]: editing };
  emit();
}

export function useRecordEdit() {
  const { pathname } = useLocation();
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const surface = recordSurface(pathname);
  return {
    pathname,
    surface,
    editing: state[pathname] === true,
    setEditing: (editing: boolean) => setRecordEditing(pathname, editing),
  };
}

export function useCanEditSurface(surface: RecordSurface | null): boolean {
  const user = useCurrentUser();
  const { effective, isLoading } = useEffectivePermissions();
  const equipment = useMayEditEquipment();
  if (!surface || !user) return false;
  if (surface.kind === "list" && canMaintainMasterList(user)) return true;
  if (surface.access === "equipment-list") return equipment.mayEdit;
  if (surface.access === "any") return true;
  if (user.roleName === "admin" || user.roleName === "owner") return true;
  if (isLoading || !effective) return false;
  return effective[surface.access] === "edit";
}

/** Edit control for filled forms and blank-form fill views. Master lists render the same button in their own header. */
export function RecordEditBar() {
  const { surface, editing, setEditing } = useRecordEdit();
  const canEdit = useCanEditSurface(surface);
  if (!surface || surface.kind !== "form" || !canEdit) return null;

  return (
    <div className="no-print sticky top-0 z-20 mb-3 flex justify-end bg-background/90 py-1 backdrop-blur-sm">
      <RecordEditButton
        editing={editing}
        onClick={() => {
          const next = !editing;
          setEditing(next);
          if (next) {
            const pane = document.activeElement?.closest("[data-pane]") ?? document.getElementById("main-content");
            focusFirstEditable(pane);
          }
        }}
      />
    </div>
  );
}
