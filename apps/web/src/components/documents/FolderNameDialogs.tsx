import { useEffect, useMemo, useRef, useState } from "react";
import { TextField } from "../forms/Field";
import { Modal } from "../modals/Modal";
import { folderChain, type BrowseFolder } from "../../lib/folderBrowse";
import { defaultRetireDestinationId, isBlankLibraryFolder, retireDestinationChoices } from "../../lib/folderActions";
import { folderNameTaken } from "../../lib/folderIdentity";

export function FolderActionButtons({
  canRename,
  canDelete,
  pending,
  onEdit,
  onDelete,
  size = "compact",
}: {
  canRename: boolean;
  canDelete: boolean;
  pending?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  size?: "compact" | "toolbar";
}) {
  if (!canRename && !canDelete) return null;
  const editClass =
    size === "toolbar"
      ? "rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:opacity-60"
      : "rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-60";
  const deleteClass =
    size === "toolbar"
      ? "rounded-md border border-border bg-card px-3 py-1.5 text-sm text-destructive hover:bg-muted disabled:opacity-60"
      : "rounded-md border border-border bg-card px-2 py-1 text-xs text-destructive hover:bg-muted disabled:opacity-60";
  return (
    <>
      {canRename && (
        <button type="button" data-testid="edit-folder" disabled={pending} onClick={onEdit} className={editClass}>
          Edit folder
        </button>
      )}
      {canDelete && (
        <button type="button" data-testid="delete-folder" disabled={pending} onClick={onDelete} className={deleteClass}>
          Delete folder
        </button>
      )}
    </>
  );
}

export function NewFolderDialog({
  open,
  parentName,
  siblingNames,
  pending,
  onClose,
  onCreate,
}: {
  open: boolean;
  parentName: string;
  siblingNames: readonly string[];
  pending: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setValue("");
      setError(null);
    }
  }, [open, parentName]);
  return (
    <Modal title="New folder" isOpen={open} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const next = value.trim().replace(/\s+/g, " ");
          if (!next || pending) return;
          if (folderNameTaken(next, siblingNames)) {
            setError("A folder with that name is already here.");
            return;
          }
          setError(null);
          onCreate(next);
        }}
      >
        <TextField
          label="Folder name"
          value={value}
          autoFocus
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
        />
        <p className="text-xs text-muted-foreground">Creates a folder in {parentName}.</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex items-center gap-2">
          <button type="submit" disabled={pending || value.trim().length === 0} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
            {pending ? "Creating…" : "Create"}
          </button>
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function RenameFolderDialog({
  open,
  name,
  pending,
  onClose,
  onSave,
}: {
  open: boolean;
  name: string;
  pending: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [value, setValue] = useState(name);
  useEffect(() => {
    if (open) setValue(name);
  }, [open, name]);
  return (
    <Modal title="Edit folder" isOpen={open} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const next = value.trim().replace(/\s+/g, " ");
          if (!next || pending) return;
          onSave(next);
        }}
      >
        <TextField label="Folder name" value={value} autoFocus onChange={(event) => setValue(event.target.value)} />
        <p className="text-xs text-muted-foreground">An empty name is not saved. A name that matches another folder here, aside from capital letters and spaces, is not saved either.</p>
        <button type="submit" disabled={pending || value.trim().length === 0} className="w-fit rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
          {pending ? "Saving…" : "Save"}
        </button>
      </form>
    </Modal>
  );
}

export function DeleteFolderDialog({
  open,
  folderName,
  folderId,
  folders,
  savedCount,
  pending,
  blockBlankLibrary,
  onClose,
  onConfirm,
}: {
  open: boolean;
  folderName: string;
  /** Document folder being deleted. Null for a Folders tab row, which has no parent in the document tree. */
  folderId: number | null;
  folders: BrowseFolder[];
  savedCount: number;
  pending: boolean;
  blockBlankLibrary?: boolean;
  onClose: () => void;
  onConfirm: (destinationId: number | null) => void;
}) {
  const needsDestination = savedCount > 0;
  const choices = useMemo(
    () => (folderId == null ? folders.filter((folder) => !blockBlankLibrary || !isBlankLibraryFolder(folders, folder.id)) : retireDestinationChoices(folders, folderId)),
    [folderId, folders, blockBlankLibrary],
  );
  const fallback = folderId == null ? null : defaultRetireDestinationId(folders, folderId);
  const [destinationId, setDestinationId] = useState<number | null>(fallback);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const start = fallback != null && choices.some((folder) => folder.id === fallback) ? fallback : (choices[0]?.id ?? null);
      setDestinationId(needsDestination ? start : null);
    }
    wasOpen.current = open;
  }, [open, folderId, folderName, needsDestination, fallback, choices]);

  return (
    <Modal title="Delete folder" isOpen={open} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          if (needsDestination && destinationId == null) return;
          onConfirm(needsDestination ? destinationId : null);
        }}
      >
        {needsDestination ? (
          <>
            <p className="text-sm text-foreground">
              "{folderName}" has {savedCount === 1 ? "1 item" : `${savedCount} items`} in it. Choose where those go. They are moved, then this folder is deleted.
            </p>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-semibold text-muted-foreground">Move contents to</span>
              <select
                className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground"
                value={destinationId ?? ""}
                onChange={(event) => setDestinationId(event.target.value ? Number(event.target.value) : null)}
              >
                <option value="">Choose a folder</option>
                {choices.map((folder) => {
                  const path = folderChain(folders, folder.id)
                    .map((crumb) => crumb.name)
                    .join(" / ");
                  return (
                    <option key={folder.id} value={folder.id}>
                      {path || folder.name}
                    </option>
                  );
                })}
              </select>
            </label>
          </>
        ) : (
          <p className="text-sm text-foreground">"{folderName}" is empty. Delete it? It will not be created again.</p>
        )}
        <button type="submit" disabled={pending || (needsDestination && destinationId == null)} className="w-fit rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground disabled:opacity-60">
          {pending ? "Deleting…" : needsDestination ? "Move contents and delete" : "Delete"}
        </button>
      </form>
    </Modal>
  );
}
