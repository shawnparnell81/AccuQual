import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useCurrentUser } from "../../hooks/useAuth";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { BEGIN_EDIT_ERROR, BEGIN_EDIT_TIMEOUT_MS } from "../../lib/beginEdit";
import { isLockedRecordPath, recordEditPath, recordSurface, type RecordSurface } from "../../lib/recordSurface";
import { useDirtyPathStore } from "../../store/dirtyPathStore";
import { useConfirm } from "./ConfirmDialog";
import { focusFirstEditable } from "./GridClipboard";
import { RecordEditButton } from "./RecordEditButton";

let snapshot: Record<string, boolean> = {};
let managed: Record<string, number> = {};
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

function getManaged() {
  return managed;
}

export function setRecordEditing(path: string, editing: boolean) {
  if (snapshot[path] === editing) return;
  snapshot = { ...snapshot, [path]: editing };
  emit();
}

/** A page with its own Edit / Save / Cancel bar. The shared bar stays hidden; the page lock still applies. */
export function registerManagedRecord(path: string): () => void {
  managed = { ...managed, [path]: (managed[path] ?? 0) + 1 };
  emit();
  return () => {
    const next = { ...managed };
    if ((next[path] ?? 0) <= 1) delete next[path];
    else next[path] = next[path]! - 1;
    managed = next;
    emit();
  };
}

export function useRecordEdit() {
  const { pathname } = useLocation();
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const managedPaths = useSyncExternalStore(subscribe, getManaged, getManaged);
  const surface = recordSurface(pathname);
  return {
    pathname,
    surface,
    managed: Boolean(managedPaths[pathname]),
    editing: state[pathname] === true,
    setEditing: (editing: boolean) => setRecordEditing(pathname, editing),
  };
}

export function useCanEditSurface(surface: RecordSurface | null): boolean {
  const user = useCurrentUser();
  const { effective, isLoading } = useEffectivePermissions();
  if (!surface || !user) return false;
  if (surface.access === "any") return true;
  if (user.roleName === "admin" || user.roleName === "owner") return true;
  if (isLoading || !effective) return false;
  return effective[surface.access] === "edit";
}

const LOCKABLE = "input, textarea, select, button, [contenteditable='true']";
const EXEMPT = "[data-lock-exempt], [data-lock-exempt] *, [role='tab'], [role='tablist'] *, [data-testid='form-edit'], [data-testid='record-edit'], [aria-label='Print'], [aria-label*='PDF'], [aria-label*='Download']";
const MARK = "data-record-locked";

function exempt(el: Element): boolean {
  if (el.matches(EXEMPT)) return true;
  const label = (el.textContent ?? "").trim();
  return el.tagName === "BUTTON" && /^(Edit|Print|Download PDF|PDF|Export|Open form|Show more|Show less|Expand|Collapse)\b/i.test(label);
}

function lockNode(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(LOCKABLE).forEach((el) => {
    if (el.hasAttribute(MARK) || exempt(el)) return;
    if (el.isContentEditable) {
      el.setAttribute(MARK, "ce");
      el.setAttribute("contenteditable", "false");
      return;
    }
    const field = el as HTMLInputElement;
    if (field.disabled) return;
    el.setAttribute(MARK, "1");
    field.disabled = true;
  });
}

function unlockNode(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(`[${MARK}]`).forEach((el) => {
    if (el.getAttribute(MARK) === "ce") el.setAttribute("contenteditable", "true");
    else (el as HTMLInputElement).disabled = false;
    el.removeAttribute(MARK);
  });
}

/** Read-only until Edit: every field and action inside the record is disabled, except tabs, print and the Edit control. */
export function useRecordPageLock(ref: RefObject<HTMLElement | null>, locked: boolean) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (!locked) {
      unlockNode(root);
      return;
    }
    lockNode(root);
    const observer = new MutationObserver(() => lockNode(root));
    observer.observe(root, { subtree: true, childList: true });
    return () => {
      observer.disconnect();
      unlockNode(root);
    };
  }, [ref, locked]);
}

/** True when the record in this pane should be read-only right now. */
export function useRecordLocked(): boolean {
  const { pathname, editing, managed: hasOwnBar } = useRecordEdit();
  return (hasOwnBar || isLockedRecordPath(pathname)) && !editing;
}

/** Edit / Save / Cancel for record pages without a lock bar of their own. Save and Cancel both lock the record again. */
export function RecordEditBar() {
  const { pathname, surface, editing, managed: hasOwnBar, setEditing } = useRecordEdit();
  const canEdit = useCanEditSurface(surface);
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const dirty = useDirtyPathStore((state) => Boolean(state.paths[pathname]));
  const setDirtyPath = useDirtyPathStore((state) => state.setDirtyPath);
  const [busy, setBusy] = useState<false | "start" | "save" | "cancel">(false);
  const [error, setError] = useState<string | null>(null);
  const auditPath = recordEditPath(pathname);
  const lockable = isLockedRecordPath(pathname);

  useEffect(() => () => setRecordEditing(pathname, false), [pathname]);

  if (!surface || surface.kind !== "form" || hasOwnBar) return null;
  if (lockable && !canEdit) {
    return <p className="no-print mb-3 text-sm text-muted-foreground" data-testid="record-read-only">Read only. You don't have edit access to this area.</p>;
  }
  if (surface.edit === false || !canEdit) return null;

  async function post(action: "start" | "save" | "cancel") {
    if (auditPath) await apiClient.post(auditPath, { action }, { timeout: BEGIN_EDIT_TIMEOUT_MS });
    void queryClient.invalidateQueries({ queryKey: ["workflow-history"] });
  }

  async function run(action: "start" | "save" | "cancel") {
    if (busy) return;
    setBusy(action);
    setError(null);
    try {
      if (action === "save") {
        (document.activeElement as HTMLElement | null)?.blur?.();
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      if (action === "cancel") {
        setDirtyPath(pathname, false);
      }
      await post(action);
      setEditing(action === "start");
      // Reload the record from the server so unsaved typing is dropped.
      if (action === "cancel") void queryClient.invalidateQueries({ type: "active" });
      if (action === "start") {
        const pane = document.querySelector(`[data-kept-path="${CSS.escape(pathname)}"]`) ?? document.getElementById("main-content");
        setTimeout(() => focusFirstEditable(pane), 0);
      }
    } catch {
      setError(action === "start" ? BEGIN_EDIT_ERROR : "Couldn't record that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (dirty) {
      const ok = await confirm({ title: "Discard unsaved changes?", message: "Cancel discards changes you have not saved and locks this record.", confirmLabel: "Discard" });
      if (!ok) return;
    }
    await run("cancel");
  }

  if (!lockable) {
    return (
      <div className="no-print sticky top-0 z-20 mb-3 flex justify-end bg-background/90 py-1 backdrop-blur-sm">
        <RecordEditButton editing={editing} onClick={() => setEditing(!editing)} />
      </div>
    );
  }

  return (
    <div data-lock-exempt className="no-print sticky top-0 z-20 mb-3 flex items-center justify-end gap-2 bg-background/90 py-1 backdrop-blur-sm">
      {error ? <span className="text-sm text-destructive" role="alert">{error}</span> : null}
      {editing ? (
        <>
          <span className="text-sm text-muted-foreground">Editing. Save keeps your changes, Cancel discards them.</span>
          <button type="button" data-testid="form-save" disabled={Boolean(busy)} onClick={() => void run("save")} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
            {busy === "save" ? "Saving…" : "Save"}
          </button>
          <button type="button" data-testid="form-cancel-edit" disabled={Boolean(busy)} onClick={() => void cancel()} className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground disabled:opacity-60">
            {busy === "cancel" ? "Canceling…" : "Cancel"}
          </button>
        </>
      ) : (
        <button type="button" data-testid="form-edit" disabled={Boolean(busy)} onClick={() => void run("start")} className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground disabled:opacity-60">
          {busy ? "Opening…" : "Edit"}
        </button>
      )}
    </div>
  );
}
