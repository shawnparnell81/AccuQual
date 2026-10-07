import { useEffect, useMemo, useState, type DragEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { GripVertical, SlidersHorizontal } from "lucide-react";
import { apiClient } from "../../api/client";
import { useFormTemplates } from "../../api/formTemplatesQuery";
import { useCurrentUser } from "../../hooks/useAuth";
import { extractErrorMessageAsync } from "../../hooks/useWorkflowAction";
import { useSidebarPrefs } from "../../hooks/useSidebarPrefs";
import { readRecentRecords } from "../../lib/recentRecords";
import { dropPosition } from "../../lib/listReorder";
import { placementParent } from "../../lib/sidebarLayout";
import { EXTRA_SIDEBAR_PAGES, acceptSidebarPath, resourceForPath, sidebarAllows } from "../../lib/sidebarAccess";
import { EMPTY_SIDEBAR_SHORTCUTS } from "../../lib/sidebarShortcuts";
import {
  addGroup,
  addPin,
  draftFromPrefs,
  draftToPrefs,
  editorNodes,
  layoutRows,
  moveDraftInto,
  moveDraftItem,
  nudgeDraft,
  pinKeyForPath,
  removeGroup,
  removePin,
  toggleHidden,
  type SidebarDraft,
} from "../../lib/sidebarUserLayout";
import { sidebarDestinations } from "../../lib/sidebarLayout";
import { flattenSidebarLinks, type SidebarNode } from "./sidebarStructure";
import { useToast } from "../shared/ToastProvider";
import { Modal } from "../modals/Modal";

const DRAG_TYPE = "application/x-accuqual-side";

interface DocFolder {
  id: number;
  name: string;
  parentId: number | null;
}

export function SidebarShortcutsButton({ catalog, placement = "sidebar" }: { catalog: SidebarNode[]; placement?: "sidebar" | "page" }) {
  const [open, setOpen] = useState(false);
  const sidebar = placement === "sidebar";
  return (
    <>
      <button
        type="button"
        className={sidebar ? "aq-side-shortcuts" : "inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"}
        data-testid="customize-sidebar"
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal size={16} />
        <span>Customize sidebar</span>
      </button>
      <SidebarShortcutsDialog catalog={catalog} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function SidebarShortcutsDialog({ catalog, open, onClose }: { catalog: SidebarNode[]; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const user = useCurrentUser();
  const { prefs, access, save, reset } = useSidebarPrefs();
  const templates = useFormTemplates({ enabled: open });
  const folders = useQuery({
    queryKey: ["document-folders"],
    enabled: open && sidebarAllows("documents", access),
    queryFn: async () => (await apiClient.get<DocFolder[]>("/document-folders")).data,
  });
  const [draft, setDraft] = useState<SidebarDraft>(() => draftFromPrefs(catalog, EMPTY_SIDEBAR_SHORTCUTS));
  const [find, setFind] = useState("");
  const [sectionName, setSectionName] = useState("");
  const [recordPath, setRecordPath] = useState("");
  const [kind, setKind] = useState<"pages" | "folders" | "forms" | "records">("pages");

  useEffect(() => {
    if (!open) return;
    setDraft(draftFromPrefs(catalog, prefs));
    setFind("");
    setSectionName("");
    setRecordPath("");
  }, [open, prefs, catalog]);

  const rows = useMemo(() => layoutRows(draft, catalog), [draft, catalog]);
  const tree = useMemo(() => editorNodes(draft, catalog), [draft, catalog]);
  const visiblePaths = useMemo(() => new Set(flattenSidebarLinks(tree).filter((link) => !draft.hidden.includes(link.key)).map((link) => link.path)), [tree, draft.hidden]);
  const catalogByPath = useMemo(() => {
    const map = new Map<string, string>();
    for (const link of flattenSidebarLinks(catalog)) map.set(link.path, link.key);
    return map;
  }, [catalog]);

  const needle = find.trim().toLowerCase();
  const pages = useMemo(() => {
    const fromMenu = flattenSidebarLinks(catalog).map((link) => ({ key: link.key, label: link.label, path: link.path }));
    const extra = EXTRA_SIDEBAR_PAGES.filter((page) => sidebarAllows(resourceForPath(page.path), access));
    const seen = new Set<string>();
    const out = [];
    for (const page of [...fromMenu, ...extra]) {
      if (seen.has(page.path)) continue;
      seen.add(page.path);
      if (needle && !`${page.label} ${page.path}`.toLowerCase().includes(needle)) continue;
      out.push(page);
    }
    return out;
  }, [catalog, access, needle]);

  const folderChoices = useMemo(() => {
    const rows = folders.data ?? [];
    return rows
      .map((folder) => ({
        id: folder.id,
        label: folderPath(rows, folder.id),
        path: `/documents/folders?folder=${folder.id}`,
      }))
      .filter((folder) => !needle || folder.label.toLowerCase().includes(needle))
      .slice(0, 40);
  }, [folders.data, needle]);

  const formChoices = useMemo(() => {
    return (templates.data ?? [])
      .filter((form) => form.subjectRoute && sidebarAllows(resourceForPath(form.subjectRoute), access))
      .map((form) => ({
        key: `blank:${form.formKey}`,
        label: form.formId ? `${form.title} (${form.formId})` : form.title,
        path: form.subjectRoute,
      }))
      .filter((form) => !needle || `${form.label} ${form.path}`.toLowerCase().includes(needle))
      .slice(0, 40);
  }, [templates.data, access, needle]);

  const recent = useMemo(() => {
    return readRecentRecords(user?.id)
      .map((record) => ({ ...record, path: acceptSidebarPath(record.path) }))
      .filter((record): record is { path: string; title: string; type: string } => Boolean(record.path) && sidebarAllows(resourceForPath(record.path!), access))
      .filter((record) => !needle || `${record.title} ${record.path}`.toLowerCase().includes(needle));
  }, [user?.id, access, needle]);

  function fail(err: unknown) {
    void extractErrorMessageAsync(err, "Couldn't save your sidebar").then((message) => toast.error(message));
  }

  function place(draggedKey: string, targetKey: string, position: "before" | "after" | "inside") {
    setDraft((current) => {
      const target = placementParent(current.layout, targetKey);
      if (!target) return current;
      if (position === "inside") return moveDraftInto(current, draggedKey, targetKey);
      const index = position === "before" ? target.index : target.index + 1;
      return moveDraftItem(current, draggedKey, target.parentKey, index);
    });
  }

  function pinPath(label: string, path: string, key?: string) {
    const safe = acceptSidebarPath(path);
    if (!safe) {
      toast.error("That page is not in AccuQual.");
      return;
    }
    if (!sidebarAllows(resourceForPath(safe), access)) return;
    const existing = catalogByPath.get(safe);
    if (existing) {
      setDraft((current) => (current.hidden.includes(existing) ? toggleHidden(current, existing) : current));
      return;
    }
    setDraft((current) => addPin(current, { key: key && /^[A-Za-z0-9:_-]+$/.test(key) ? key : pinKeyForPath(safe), label, path: safe }));
  }

  return (
    <Modal title="Customize sidebar" isOpen={open} onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm" data-testid="customize-sidebar-dialog">
        <p className="text-muted-foreground">Choose what shows, the order, and your own sections. This is your menu only. Reset puts the original menu back.</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 font-medium">Your menu</h3>
            <ul className="max-h-80 overflow-auto rounded-md border border-border" data-testid="customize-sidebar-rows">
              {rows.map((row) => (
                <MenuRow
                  key={row.key}
                  row={row}
                  destinations={sidebarDestinations(tree, row.key)}
                  onToggle={() => setDraft((current) => toggleHidden(current, row.key))}
                  onNudge={(direction) => setDraft((current) => nudgeDraft(current, row.key, direction))}
                  onMove={(parentKey) => setDraft((current) => moveDraftInto(current, row.key, parentKey))}
                  onRemove={
                    row.kind === "pin"
                      ? () => setDraft((current) => removePin(current, row.key))
                      : row.key.startsWith("group:")
                        ? () => setDraft((current) => removeGroup(current, row.key))
                        : undefined
                  }
                  onDrop={place}
                />
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <input
                value={sectionName}
                onChange={(event) => setSectionName(event.target.value)}
                placeholder="New section name"
                aria-label="New section name"
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2"
              />
              <button type="button" className="rounded-md border border-border px-3 py-2" onClick={() => { setDraft((current) => addGroup(current, sectionName)); setSectionName(""); }}>
                Add section
              </button>
            </div>
          </div>
          <div>
            <h3 className="mb-2 font-medium">Add something</h3>
            <div className="mb-2 flex flex-wrap gap-1" role="tablist" aria-label="What to add">
              {(
                [
                  ["pages", "Pages"],
                  ["folders", "Folders"],
                  ["forms", "Forms"],
                  ["records", "Records"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={kind === id}
                  className={`rounded-md px-2 py-1 ${kind === id ? "bg-primary text-primary-foreground" : "border border-border"}`}
                  onClick={() => setKind(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              value={find}
              onChange={(event) => setFind(event.target.value)}
              placeholder={kind === "records" ? "Find a recent record" : "Find a page, folder, or form"}
              aria-label="Find something to add"
              className="mb-2 w-full rounded-md border border-border bg-background px-3 py-2"
            />
            {kind === "records" && (
              <form
                className="mb-2 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  pinPath(recordPath.trim() || "Record", recordPath.trim());
                  setRecordPath("");
                }}
              >
                <input
                  value={recordPath}
                  onChange={(event) => setRecordPath(event.target.value)}
                  placeholder="/ncr/12"
                  aria-label="Record address"
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2"
                />
                <button type="submit" className="rounded-md border border-border px-3 py-2">
                  Pin
                </button>
              </form>
            )}
            <ul className="max-h-64 overflow-auto rounded-md border border-border">
              {kind === "pages" &&
                pages.slice(0, 40).map((page) => (
                  <Choice key={page.path} label={page.label} showing={visiblePaths.has(page.path)} onPin={() => pinPath(page.label, page.path)} />
                ))}
              {kind === "folders" && folderChoices.map((folder) => <Choice key={folder.id} label={folder.label} showing={visiblePaths.has(folder.path)} onPin={() => pinPath(folder.label, folder.path)} />)}
              {kind === "forms" && formChoices.map((form) => <Choice key={form.key} label={form.label} showing={visiblePaths.has(form.path)} onPin={() => pinPath(form.label, form.path, form.key)} />)}
              {kind === "records" && recent.map((record) => <Choice key={record.path} label={record.title || record.path} showing={visiblePaths.has(record.path)} onPin={() => pinPath(record.title || record.type, record.path)} />)}
              {((kind === "pages" && pages.length === 0) || (kind === "folders" && folderChoices.length === 0) || (kind === "forms" && formChoices.length === 0) || (kind === "records" && recent.length === 0)) && (
                <li className="px-3 py-2 text-muted-foreground">No matches.</li>
              )}
            </ul>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-2"
            data-testid="customize-sidebar-reset"
            disabled={reset.isPending || save.isPending}
            onClick={() => reset.mutate(undefined, { onError: fail })}
          >
            Reset to default
          </button>
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-60"
            data-testid="customize-sidebar-save"
            disabled={save.isPending || reset.isPending}
            onClick={() => save.mutate(draftToPrefs(draft), { onSuccess: () => onClose(), onError: fail })}
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function folderPath(folders: DocFolder[], id: number): string {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  let current = byId.get(id);
  const seen = new Set<number>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId == null ? undefined : byId.get(current.parentId);
  }
  return names.join(" / ") || "Folder";
}

function Choice({ label, showing, onPin }: { label: string; showing: boolean; onPin: () => void }) {
  return (
    <li className="flex items-center justify-between gap-2 px-3 py-1.5">
      <span className="min-w-0 truncate">{label}</span>
      {showing ? (
        <span className="text-xs text-muted-foreground">Already showing</span>
      ) : (
        <button type="button" className="text-xs text-primary hover:underline" onClick={onPin}>
          Pin
        </button>
      )}
    </li>
  );
}

function MenuRow({
  row,
  destinations,
  onToggle,
  onNudge,
  onMove,
  onRemove,
  onDrop,
}: {
  row: { key: string; label: string; depth: number; kind: "item" | "section" | "pin"; hidden: boolean };
  destinations: { key: string | null; label: string; depth: number }[];
  onToggle: () => void;
  onNudge: (direction: -1 | 1) => void;
  onMove: (parentKey: string | null) => void;
  onRemove?: () => void;
  onDrop: (draggedKey: string, targetKey: string, position: "before" | "after" | "inside") => void;
}) {
  const [hint, setHint] = useState<"before" | "after" | "inside" | null>(null);
  const nest = row.kind === "section";
  return (
    <li
      className={`flex items-center gap-1 border-b border-border px-2 py-1 last:border-b-0 ${row.hidden ? "text-muted-foreground" : ""} ${hint ? `aq-drop-${hint}` : ""}`}
      style={{ paddingLeft: 8 + row.depth * 14 }}
      onDragOver={(event) => {
        if (!Array.from(event.dataTransfer.types).includes(DRAG_TYPE)) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const next = dropPosition(event.clientY, rect.top, rect.height, nest);
        setHint(next === "inside" && !nest ? "before" : next);
      }}
      onDragLeave={() => setHint(null)}
      onDrop={(event: DragEvent) => {
        event.preventDefault();
        const dragged = event.dataTransfer.getData(DRAG_TYPE);
        const position = hint;
        setHint(null);
        if (dragged && position) onDrop(dragged, row.key, position);
      }}
    >
      <button
        type="button"
        draggable
        className="cursor-grab text-muted-foreground active:cursor-grabbing"
        aria-label={`Drag ${row.label}`}
        title={`Drag ${row.label}`}
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAG_TYPE, row.key);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => setHint(null)}
      >
        <GripVertical size={14} />
      </button>
      <label className="flex min-w-0 flex-1 items-center gap-2">
        <input type="checkbox" checked={!row.hidden} onChange={onToggle} aria-label={`Show ${row.label}`} />
        <span className="truncate">{row.label}</span>
      </label>
      <button type="button" className="rounded px-1 text-xs text-muted-foreground hover:text-foreground" aria-label={`Move ${row.label} up`} onClick={() => onNudge(-1)}>
        Up
      </button>
      <button type="button" className="rounded px-1 text-xs text-muted-foreground hover:text-foreground" aria-label={`Move ${row.label} down`} onClick={() => onNudge(1)}>
        Down
      </button>
      <select
        aria-label={`Move ${row.label} into a section`}
        className="max-w-28 rounded border border-border bg-background px-1 py-0.5 text-xs"
        value=""
        onChange={(event) => {
          const value = event.target.value;
          if (!value) return;
          onMove(value === "root" ? null : value);
        }}
      >
        <option value="">Move to…</option>
        {destinations.map((destination) => (
          <option key={destination.key ?? "root"} value={destination.key ?? "root"}>
            {destination.label}
          </option>
        ))}
      </select>
      {onRemove && (
        <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={onRemove}>
          Remove
        </button>
      )}
    </li>
  );
}
