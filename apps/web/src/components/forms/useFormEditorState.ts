import { useEffect, useRef, useState } from "react";
import { useFormData, useSaveForm } from "../../api/formHooks";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useReportTabDirty } from "../../hooks/useReportTabDirty";
import { useToast } from "../shared/ToastProvider";
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
  const toast = useToast();
  const { setDirty, setSaving } = useFormStore();

  const [values, setValues] = useState<Record<string, unknown>>({});
  const [unsaved, setUnsaved] = useState(false);
  useReportTabDirty(unsaved);
  // Kept off the render path on purpose. Assigning `values` back onto this
  // ref during render lets a parent re-render (or a burst of summary writes)
  // replace a just-typed payload with the previous state before it is saved.
  const valuesRef = useRef(values);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout>>();
  const hydrated = useRef(false);
  const lastServerStamp = useRef("");
  // True from the first keystroke of an edit until its autosave settles —
  // guards the re-hydrate below from clobbering an in-progress local edit.
  const isDirty = useRef(false);
  // Bumps on every edit. A save that started earlier must not clear the dirty
  // flag, and saves run one at a time so an older payload cannot land last.
  const editGeneration = useRef(0);
  const saveQueue = useRef(Promise.resolve());

  // Hydrate local field state when the current form_data row first loads,
  // and again whenever the server's own version advances from a write this
  // hook didn't make itself (e.g. NCR's workflow actions syncing a field
  // onto the official document server-side — see ncr.formSync.ts) — as long
  // as there's no unsaved local edit in flight that a re-hydrate would wipe.
  useEffect(() => {
    if (!formData) return;
    const stamp = `${formData.updatedAt ?? ""}:${formData.version ?? ""}`;
    if (!hydrated.current || (stamp !== lastServerStamp.current && !isDirty.current)) {
      const next = { ...(formData.data ?? {}) };
      delete next._formTemplate;
      valuesRef.current = next;
      setValues(next);
      hydrated.current = true;
    }
    lastServerStamp.current = stamp;
  }, [formData]);

  function flushSave() {
    const task = saveQueue.current.then(async () => {
      const generation = editGeneration.current;
      const payload = valuesRef.current;
      if (windowId) setSaving(windowId, true);
      try {
        await saveForm.mutateAsync(payload);
        if (editGeneration.current === generation) {
          isDirty.current = false;
          setUnsaved(false);
          if (windowId) setDirty(windowId, false);
        }
      } catch (err) {
        toast.error(extractErrorMessage(err, "Couldn't save this form."));
        throw err;
      } finally {
        if (windowId) setSaving(windowId, false);
      }
    });
    saveQueue.current = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  /** Show a server-owned value in the document immediately, without starting another save. */
  function previewField(name: string, value: unknown) {
    previewPatch({ [name]: value });
  }

  function previewPatch(patch: Record<string, unknown>) {
    const next = { ...valuesRef.current, ...patch };
    valuesRef.current = next;
    setValues(next);
  }

  function updateField(name: string, value: unknown) {
    editGeneration.current += 1;
    const next = { ...valuesRef.current, [name]: value };
    valuesRef.current = next;
    setValues(next);
    isDirty.current = true;
    setUnsaved(true);
    if (windowId) setDirty(windowId, true);

    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      void flushSave();
    }, AUTOSAVE_DELAY_MS);
  }

  async function saveNow() {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    if (!isDirty.current) return;
    await flushSave();
  }

  return { formData, isLoading, values, updateField, previewField, previewPatch, saveNow, isSaving: saveForm.isPending };
}
