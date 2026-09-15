import { useEffect, useRef, useState } from "react";
import { useFormData, useSaveForm } from "../../api/formHooks";
import { useFormStore } from "../../store/formStore";

const AUTOSAVE_DELAY_MS = 1200;

/**
 * Shared data + autosave core for one form_data row: hydrates local field
 * state from the current row once it loads, and debounce-autosaves edits
 * 1200ms after the last keystroke. `windowId` is optional — when the form is
 * opened inside a floating window (see window-manager/), dirty/saving state
 * is also reported into formStore for that window's title bar; the inline
 * NCR workspace pane (not inside a window) simply omits it.
 *
 * Extracted out of FormEditor.tsx so this behavior can't drift between the
 * floating-window editor (every form type) and NcrWorkspacePage's inline
 * form pane (NCR only) — both need the exact same hydrate/autosave contract.
 */
export function useFormEditorState(formType: string, entityId: number, windowId?: string) {
  const { data: formData, isLoading } = useFormData(formType, entityId);
  const saveForm = useSaveForm(formType, entityId);
  const { setDirty, setSaving } = useFormStore();

  const [values, setValues] = useState<Record<string, unknown>>({});
  const autosaveTimer = useRef<ReturnType<typeof setTimeout>>();
  const hydrated = useRef(false);

  // Hydrate local field state once the current form_data row loads.
  useEffect(() => {
    if (!hydrated.current && formData) {
      setValues(formData.data ?? {});
      hydrated.current = true;
    }
  }, [formData]);

  function updateField(name: string, value: unknown) {
    const next = { ...values, [name]: value };
    setValues(next);
    if (windowId) setDirty(windowId, true);

    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      if (windowId) setSaving(windowId, true);
      saveForm.mutate(next, {
        onSettled: () => {
          if (windowId) {
            setSaving(windowId, false);
            setDirty(windowId, false);
          }
        },
      });
    }, AUTOSAVE_DELAY_MS);
  }

  return { formData, isLoading, values, updateField, isSaving: saveForm.isPending };
}
