import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pin } from "lucide-react";
import { apiClient } from "../../api/client";
import { extractErrorMessageAsync } from "../../hooks/useWorkflowAction";
import {
  EMPTY_SIDEBAR_SHORTCUTS,
  PINNABLE_SHORTCUTS,
  applyUserShortcuts,
  sidebarToggleRows,
  type PinnedShortcut,
  type SidebarShortcutPrefs,
} from "../../lib/sidebarShortcuts";
import type { SidebarNode } from "./sidebarStructure";
import { flattenSidebarLinks } from "./sidebarStructure";
import { useToast } from "../shared/ToastProvider";
import { Modal } from "../modals/Modal";

interface FormTemplateLink {
  formKey: string;
  formId: string;
  title: string;
  subjectRoute: string;
  start: { createPath: string } | null;
}

export function SidebarShortcutsButton({ catalog, placement = "sidebar" }: { catalog: SidebarNode[]; placement?: "sidebar" | "page" }) {
  const [open, setOpen] = useState(false);
  const sidebar = placement === "sidebar";
  return (
    <>
      <button type="button" className={sidebar ? "aq-side-shortcuts" : "inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"} onClick={() => setOpen(true)}>
        <Pin size={16} />
        <span>{sidebar ? "Shortcuts" : "Choose sidebar shortcuts"}</span>
      </button>
      <SidebarShortcutsDialog catalog={catalog} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function SidebarShortcutsDialog({ catalog, open, onClose }: { catalog: SidebarNode[]; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const saved = useQuery({
    queryKey: ["sidebar-shortcuts"],
    queryFn: async () => (await apiClient.get<SidebarShortcutPrefs>("/users/me/sidebar-shortcuts")).data,
  });
  const templates = useQuery({
    queryKey: ["form-templates"],
    enabled: open,
    queryFn: async () => (await apiClient.get<{ templates: FormTemplateLink[] }>("/document-folders/form-templates")).data.templates,
  });
  const [hidden, setHidden] = useState<string[]>([]);
  const [pinned, setPinned] = useState<PinnedShortcut[]>([]);
  const [find, setFind] = useState("");

  useEffect(() => {
    if (!open) return;
    setHidden(saved.data?.hidden ?? []);
    setPinned(saved.data?.pinned ?? []);
    setFind("");
  }, [open, saved.data]);

  const save = useMutation({
    mutationFn: async (prefs: SidebarShortcutPrefs) => (await apiClient.put<SidebarShortcutPrefs>("/users/me/sidebar-shortcuts", prefs)).data,
    onSuccess: (prefs) => {
      qc.setQueryData(["sidebar-shortcuts"], prefs);
      onClose();
    },
    onError: async (err) => toast.error(await extractErrorMessageAsync(err, "Couldn't save your sidebar")),
  });

  const rows = useMemo(() => sidebarToggleRows(catalog), [catalog]);
  const visiblePaths = useMemo(() => {
    const shown = applyUserShortcuts(catalog, { hidden, pinned: [] });
    return new Set(flattenSidebarLinks(shown).map((link) => link.path));
  }, [catalog, hidden]);

  const choices = useMemo(() => {
    const blanks: PinnedShortcut[] = (templates.data ?? [])
      .filter((form) => form.start)
      .map((form) => ({
        key: `blank:${form.formKey}`,
        label: form.formId ? `${form.title} (${form.formId})` : form.title,
        path: form.subjectRoute,
      }));
    const needle = find.trim().toLowerCase();
    return [...PINNABLE_SHORTCUTS, ...blanks].filter((item) => {
      if (pinned.some((pin) => pin.key === item.key)) return false;
      if (!needle) return true;
      return `${item.label} ${item.path}`.toLowerCase().includes(needle);
    });
  }, [find, pinned, templates.data]);

  function toggleHidden(key: string) {
    setHidden((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  }

  return (
    <Modal title="Your sidebar" isOpen={open} onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-muted-foreground">
          Choose what shows on your sidebar. This does not change the menu for anyone else. An administrator can still rearrange the shared menu.
        </p>
        <div>
          <h3 className="mb-2 font-medium">On your sidebar</h3>
          <ul className="max-h-64 overflow-auto rounded-md border border-border">
            {rows.map((row) => (
              <li key={row.key}>
                <label className="form-check w-full px-3 py-1.5" style={{ paddingLeft: 12 + row.depth * 16 }}>
                  <input type="checkbox" checked={!hidden.includes(row.key)} onChange={() => toggleHidden(row.key)} />
                  <span>{row.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 font-medium">Shortcuts</h3>
          {pinned.length === 0 && <p className="mb-2 text-muted-foreground">Nothing pinned. The shared menu stays as it is.</p>}
          {pinned.length > 0 && (
            <ul className="mb-2 flex flex-col gap-1">
              {pinned.map((pin) => (
                <li key={pin.key} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1">
                  <span>{pin.label}</span>
                  <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setPinned((current) => current.filter((item) => item.key !== pin.key))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            value={find}
            onChange={(event) => setFind(event.target.value)}
            placeholder="Find a page or blank form"
            aria-label="Find a shortcut"
            className="mb-2 w-full rounded-md border border-border bg-background px-3 py-2"
          />
          <ul className="max-h-48 overflow-auto rounded-md border border-border">
            {choices.length === 0 && <li className="px-3 py-2 text-muted-foreground">No matches.</li>}
            {choices.slice(0, 40).map((item) => {
              const already = visiblePaths.has(item.path);
              return (
                <li key={item.key} className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <span>{item.label}</span>
                  {already ? (
                    <span className="text-xs text-muted-foreground">Already showing</span>
                  ) : (
                    <button type="button" className="text-xs text-primary hover:underline" onClick={() => setPinned((current) => [...current, item])}>
                      Pin
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-2"
            disabled={save.isPending}
            onClick={() => save.mutate(EMPTY_SIDEBAR_SHORTCUTS)}
          >
            Reset
          </button>
          <button type="button" className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-60" disabled={save.isPending} onClick={() => save.mutate({ hidden, pinned })}>
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
