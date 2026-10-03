import { useMemo, useState } from "react";
import { useDialogBehavior } from "../shared/useDialogBehavior";
import { FAI_VALIDATION_FOLDER_NAME, saveAsFolders, type BrowseFolder } from "../../lib/folderBrowse";

const ISO_DOCUMENTS_FOLDER = "ISO Compliance Documents";

const ROOT_ORDER = [ISO_DOCUMENTS_FOLDER, "Engineering", "Quality", "Audits", "Training", "Safety", "Production", "CAPA", "NCR", "8D", "Work Instruction", "Procedures", "SOP"];

const CHILD_ORDER: Record<string, string[]> = {
  [ISO_DOCUMENTS_FOLDER]: ["Engineering", "Quality", "Audits", "Training", "Safety", "Production", "CAPA", "NCR", "8D", "Work Instruction", "Procedures", "SOP"],
  Engineering: [],
  Quality: [FAI_VALIDATION_FOLDER_NAME, "Product Alerts", "Recalls", "Warranty", "Training", "Repair", "Inspections"],
  [FAI_VALIDATION_FOLDER_NAME]: ["CSA", "Shocks", "Fuel", "Brake Wear sensors", "Gas/Electric Lifts", "Air Suspension"],
  SOP: ["Policies", "Procedures"],
};

function orderedChildren(folders: BrowseFolder[], parentId: number | null, parentName: string | null): BrowseFolder[] {
  const preferred = parentId === null ? ROOT_ORDER : parentName ? (CHILD_ORDER[parentName] ?? []) : [];
  return folders
    .filter((folder) => folder.parentId === parentId)
    .sort((a, b) => {
      const aIndex = preferred.indexOf(a.name);
      const bIndex = preferred.indexOf(b.name);
      if (aIndex !== -1 || bIndex !== -1) {
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      }
      return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
    });
}

function branchMatches(folders: BrowseFolder[], folder: BrowseFolder, query: string): boolean {
  if (folder.name.toLowerCase().includes(query)) return true;
  return orderedChildren(folders, folder.id, folder.name).some((child) => branchMatches(folders, child, query));
}

function FolderBranch({
  folder,
  folders,
  depth,
  query,
  openIds,
  onToggle,
  selectedId,
  onSelect,
}: {
  folder: BrowseFolder;
  folders: BrowseFolder[];
  depth: number;
  query: string;
  openIds: Set<number>;
  onToggle: (id: number) => void;
  selectedId: number | "";
  onSelect: (id: number) => void;
}) {
  const children = orderedChildren(folders, folder.id, folder.name).filter((child) => !query || branchMatches(folders, child, query));
  const open = query.length > 0 || openIds.has(folder.id);
  const selected = selectedId === folder.id;
  return (
    <li>
      <div className="flex items-center gap-1 rounded-md" style={{ paddingLeft: depth * 14 }}>
        {children.length > 0 ? (
          <button type="button" className="w-5 shrink-0 text-xs text-muted-foreground" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${folder.name}`} onClick={() => onToggle(folder.id)}>
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => onSelect(folder.id)}
          className={`min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-sm ${selected ? "bg-primary/15 font-medium text-foreground" : "hover:bg-muted"}`}
        >
          {folder.name}
        </button>
      </div>
      {open && children.length > 0 && (
        <ul>
          {children.map((child) => (
            <FolderBranch
              key={child.id}
              folder={child}
              folders={folders}
              depth={depth + 1}
              query={query}
              openIds={openIds}
              onToggle={onToggle}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Pick a Documents folder for this filled copy. Blank Form Templates is not in the tree. */
export function SaveAsFolderDialog({
  folders,
  selectedId,
  onClose,
  onSave,
  pending,
}: {
  folders: BrowseFolder[];
  selectedId: number | "";
  onClose: () => void;
  onSave: (folderId: number, partNumber?: string) => void;
  pending: boolean;
}) {
  const ref = useDialogBehavior(true, onClose);
  const destinations = useMemo(() => saveAsFolders(folders), [folders]);
  const [query, setQuery] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [chosen, setChosen] = useState<number | "">(selectedId);
  const [openIds, setOpenIds] = useState<Set<number>>(() => {
    const open = new Set<number>();
    for (const folder of destinations) {
      if (folder.parentId === null && ROOT_ORDER.includes(folder.name)) open.add(folder.id);
      if (folder.name === ISO_DOCUMENTS_FOLDER || folder.name === FAI_VALIDATION_FOLDER_NAME || folder.name === "FAI" || folder.name === "SOP" || CHILD_ORDER.Engineering?.includes(folder.name)) open.add(folder.id);
    }
    return open;
  });
  const needle = query.trim().toLowerCase();
  const roots = orderedChildren(destinations, null, null).filter((folder) => !needle || branchMatches(destinations, folder, needle));
  const chosenFolder = destinations.find((folder) => folder.id === chosen);

  function toggle(id: number) {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-as-title"
        data-testid="save-as-picker"
        tabIndex={-1}
        className="modal-in fixed left-1/2 top-16 z-50 flex max-h-[80vh] w-full max-w-lg -translate-x-1/2 flex-col rounded-lg border border-border bg-card p-4 shadow-xl outline-none"
      >
        <h2 id="save-as-title" className="text-sm font-medium">
          Save as
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Choose a Documents folder for this filled copy. The blank template stays in Blank Forms.</p>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a folder"
          aria-label="Find a folder"
          className="mt-3 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
        />
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-md border border-border p-2" data-testid="save-as-tree">
          {roots.length === 0 ? (
            <p className="text-sm text-muted-foreground">No folders match.</p>
          ) : (
            <ul>
              {roots.map((folder) => (
                <FolderBranch
                  key={folder.id}
                  folder={folder}
                  folders={destinations}
                  depth={0}
                  query={needle}
                  openIds={openIds}
                  onToggle={toggle}
                  selectedId={chosen}
                  onSelect={setChosen}
                />
              ))}
            </ul>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{chosenFolder ? `Selected: ${chosenFolder.name}` : "Select a folder."}</p>
        <label className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
          Part number
          <input
            value={partNumber}
            onChange={(event) => setPartNumber(event.target.value)}
            maxLength={80}
            aria-label="Part number"
            placeholder="Optional — files under the folder you picked"
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
            Cancel
          </button>
          <button
            type="button"
            disabled={pending || chosen === ""}
            onClick={() => {
              if (chosen === "") return;
              onSave(chosen, partNumber.trim() || undefined);
            }}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save here"}
          </button>
        </div>
      </div>
    </>
  );
}
