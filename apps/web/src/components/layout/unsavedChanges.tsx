import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogBehavior } from "../shared/useDialogBehavior";
import {
  UNSAVED_CHANGES_TITLE,
  dirtyKeysInSection,
  dirtySubtabs,
  isCommitSaveControl,
  sectionHasUnsaved,
  unsavedChangesBody,
} from "../../lib/sectionKeepAlive";
import { useDirtyPathStore } from "../../store/dirtyPathStore";

type Decision = "cancel" | "discard" | "saved";

interface AskOptions {
  labels: string[];
  canSave: boolean;
  save?: () => Promise<boolean>;
}

const AskContext = createContext<(options: AskOptions) => Promise<Decision>>(async () => "cancel");

export function useAskUnsavedChanges() {
  return useContext(AskContext);
}

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<(AskOptions & { resolve: (value: Decision) => void }) | null>(null);

  const ask = useCallback((options: AskOptions) => {
    return new Promise<Decision>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  function finish(value: Decision) {
    pending?.resolve(value);
    setPending(null);
  }

  return (
    <AskContext.Provider value={ask}>
      {children}
      {pending && (
        <UnsavedChangesDialog
          labels={pending.labels}
          canSave={pending.canSave}
          save={pending.save}
          onDiscard={() => finish("discard")}
          onCancel={() => finish("cancel")}
          onSaved={() => finish("saved")}
        />
      )}
    </AskContext.Provider>
  );
}

function UnsavedChangesDialog({
  labels,
  canSave,
  save,
  onDiscard,
  onCancel,
  onSaved,
}: {
  labels: string[];
  canSave: boolean;
  save?: () => Promise<boolean>;
  onDiscard: () => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const ref = useDialogBehavior(true, onCancel);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  async function onSave() {
    if (!save || saving) return;
    setSaving(true);
    setFailed(false);
    const ok = await save();
    if (ok) {
      onSaved();
      return;
    }
    setSaving(false);
    setFailed(true);
  }

  const dialog = (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={saving ? undefined : onCancel} />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-title"
        aria-describedby="unsaved-changes-body"
        tabIndex={-1}
        data-testid="unsaved-changes-dialog"
        className="modal-in fixed left-1/2 top-24 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-border bg-card p-4 shadow-xl outline-none"
      >
        <h2 id="unsaved-changes-title" className="text-sm font-medium">
          {UNSAVED_CHANGES_TITLE}
        </h2>
        <p id="unsaved-changes-body" className="mt-2 text-sm text-muted-foreground">
          {unsavedChangesBody(labels)}
        </p>
        {failed && <p className="mt-2 text-sm text-destructive">Those pages could not be saved.</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {canSave && (
            <button
              type="button"
              data-testid="unsaved-save-all"
              disabled={saving}
              onClick={() => void onSave()}
              className="mr-auto rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save all"}
            </button>
          )}
          <button
            type="button"
            data-testid="unsaved-discard"
            disabled={saving}
            onClick={onDiscard}
            className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground disabled:opacity-60"
          >
            Discard and close
          </button>
          <button
            ref={cancelRef}
            type="button"
            data-testid="unsaved-cancel"
            disabled={saving}
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );

  return createPortal(dialog, document.body);
}

function commitSaveButtons(pane: ParentNode, skipNestedDrafts: boolean): HTMLButtonElement[] {
  return [...pane.querySelectorAll("button")].filter((button): button is HTMLButtonElement => {
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    if (skipNestedDrafts && button.closest("[data-draft-key]")) return false;
    const label = button.getAttribute("aria-label") || button.textContent || "";
    return isCommitSaveControl(label);
  });
}

function paneForKey(key: string): HTMLElement | null {
  if (key.includes("#")) {
    return document.querySelector<HTMLElement>(`[data-draft-key="${key.replace(/"/g, "")}"]`);
  }
  const panes = [...document.querySelectorAll<HTMLElement>(`[data-kept-path="${key.replace(/"/g, "")}"]`)];
  return panes.find((pane) => commitSaveButtons(pane, true).length > 0) ?? panes[0] ?? null;
}

/** True when every dirty sub-page in the section has an enabled save button. */
export function canSaveDirtySection(sectionPath: string): boolean {
  const items = dirtySubtabs(useDirtyPathStore.getState().paths, sectionPath);
  if (items.length === 0) return false;
  return items.every((item) => {
    const pane = paneForKey(item.key);
    return pane != null && commitSaveButtons(pane, !item.key.includes("#")).length > 0;
  });
}

/** Clicks each dirty sub-page's save button and waits until the save settles. */
export async function saveDirtySection(sectionPath: string): Promise<boolean> {
  const before = dirtyKeysInSection(useDirtyPathStore.getState().paths, sectionPath);
  const items = dirtySubtabs(useDirtyPathStore.getState().paths, sectionPath);
  const buttons: HTMLButtonElement[] = [];
  for (const item of items) {
    const pane = paneForKey(item.key);
    const found = pane ? commitSaveButtons(pane, !item.key.includes("#")) : [];
    if (found.length === 0) return false;
    buttons.push(...found);
  }
  for (const button of buttons) button.click();
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const pending = buttons.some((button) => button.isConnected && /saving/i.test(button.textContent ?? ""));
    const still = before.some((key) => useDirtyPathStore.getState().paths[key]);
    if (!pending && !still) return true;
    if (!pending && still) return false;
  }
  return !sectionHasUnsaved(useDirtyPathStore.getState().paths, sectionPath);
}
