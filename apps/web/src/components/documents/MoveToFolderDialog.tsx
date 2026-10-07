import { useMemo, useState } from "react";
import { Modal } from "../modals/Modal";
import { folderChain, isFolderEntry, saveAsFolders, type BrowseFolder } from "../../lib/folderBrowse";
import { folderMoveIsBlocked } from "../../lib/folderMove";

function childrenOf(folders: BrowseFolder[], parentId: number | null): BrowseFolder[] {
  return folders.filter((folder) => folder.parentId === parentId).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

function branchMatches(folders: BrowseFolder[], folder: BrowseFolder, query: string): boolean {
  if (folder.name.toLowerCase().includes(query)) return true;
  return childrenOf(folders, folder.id).some((child) => branchMatches(folders, child, query));
}

function MoveBranch({
  folder,
  folders,
  depth,
  query,
  movingId,
  selectedId,
  onSelect,
}: {
  folder: BrowseFolder;
  folders: BrowseFolder[];
  depth: number;
  query: string;
  movingId: number;
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const children = childrenOf(folders, folder.id).filter((child) => !query || branchMatches(folders, child, query));
  const blocked = folderMoveIsBlocked(folders, movingId, folder.id);
  const selected = selectedId === folder.id;
  return (
    <li>
      <div className="flex items-center" style={{ paddingLeft: depth * 14 }}>
        <button
          type="button"
          disabled={blocked}
          aria-pressed={selected}
          data-testid="move-target"
          data-folder-name={folder.name}
          onClick={() => onSelect(folder.id)}
          className={`min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-sm ${
            blocked ? "cursor-not-allowed text-muted-foreground" : selected ? "bg-primary/15 font-medium text-foreground" : "text-foreground hover:bg-muted"
          }`}
          title={blocked ? "A folder cannot be moved into itself." : folder.name}
        >
          {folder.name}
        </button>
      </div>
      {children.length > 0 && (
        <ul>
          {children.map((child) => (
            <MoveBranch
              key={child.id}
              folder={child}
              folders={folders}
              depth={depth + 1}
              query={query}
              movingId={movingId}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Pick a folder to receive this folder or saved item. The item's own subtree cannot be chosen. */
export function MoveToFolderDialog({
  folders,
  moving,
  pending,
  onClose,
  onMove,
}: {
  folders: BrowseFolder[];
  moving: BrowseFolder;
  pending: boolean;
  onClose: () => void;
  onMove: (parentId: number) => void;
}) {
  const destinations = useMemo(() => saveAsFolders(folders).filter((folder) => isFolderEntry(folders, folder)), [folders]);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<number | null>(null);
  const needle = query.trim().toLowerCase();
  const roots = childrenOf(destinations, null).filter((folder) => !needle || branchMatches(destinations, folder, needle));
  const chosenFolder = destinations.find((folder) => folder.id === chosen);
  const blocked = chosen != null && folderMoveIsBlocked(folders, moving.id, chosen);
  const samePlace = chosen != null && chosen === moving.parentId;
  const from = folderChain(folders, moving.id)
    .slice(0, -1)
    .map((folder) => folder.name)
    .join(" / ");

  return (
    <Modal title="Move to…" isOpen onClose={onClose} wide>
      <div data-testid="move-to-dialog" className="flex flex-col gap-3 text-foreground">
        <p className="text-sm text-muted-foreground">
          Move <span className="font-medium text-foreground">{moving.name}</span>
          {from ? ` from ${from}` : ""}. The folder you pick receives it, and a folder keeps everything inside it.
        </p>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a folder"
          aria-label="Find a folder"
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
        />
        <div className="max-h-80 overflow-y-auto rounded-md border border-border bg-background p-2" data-testid="move-to-tree">
          {roots.length === 0 ? (
            <p className="text-sm text-muted-foreground">No folders match.</p>
          ) : (
            <ul>
              {roots.map((folder) => (
                <MoveBranch key={folder.id} folder={folder} folders={destinations} depth={0} query={needle} movingId={moving.id} selectedId={chosen} onSelect={setChosen} />
              ))}
            </ul>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {blocked ? "A folder cannot be moved into itself." : samePlace ? "Already in this folder." : chosenFolder ? `Selected: ${chosenFolder.name}` : "Select a folder."}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted">
            Cancel
          </button>
          <button
            type="button"
            data-testid="move-confirm"
            disabled={pending || chosen == null || blocked || samePlace}
            onClick={() => {
              if (chosen != null) onMove(chosen);
            }}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            {pending ? "Moving…" : "Move"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
