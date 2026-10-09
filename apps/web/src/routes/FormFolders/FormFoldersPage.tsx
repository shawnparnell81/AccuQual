import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Folder } from "lucide-react";
import { apiClient } from "../../api/client";
import { DeleteFolderDialog, FolderActionButtons, RenameFolderDialog } from "../../components/documents/FolderNameDialogs";
import { useToast } from "../../components/shared/ToastProvider";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { extractErrorMessageAsync } from "../../hooks/useWorkflowAction";
import { documentsFolderHref, type BrowseFolder } from "../../lib/folderBrowse";
import { formatDateTime } from "../../lib/dates";

interface FormFolderSummary {
  formKey: string;
  formKeys?: string[];
  title: string;
  formId: string;
  name: string;
  savedCount: number;
}

interface SavedFill {
  recordId: number;
  fileName: string;
  savedAt: string;
  openPath: string;
  documentsFolderId: number | null;
}

interface FormFolderDetail {
  formKey: string;
  formKeys?: string[];
  title: string;
  formId: string;
  name: string;
  savedCount?: number;
  fills: SavedFill[];
}

function savedLabel(count: number): string {
  return count === 1 ? "1 saved" : `${count} saved`;
}

function useFolderPermissions() {
  const { effective, isLoading } = useEffectivePermissions();
  return {
    canRename: !isLoading && effective?.["folders.rename"] === "edit",
    canDelete: !isLoading && effective?.["folders.delete"] === "edit",
  };
}

/** Form-name folders. Each one opens the saved copies of that form. */
export function FormFoldersPage() {
  const [query, setQuery] = useState("");
  const [editingMode, setEditingMode] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<FormFolderSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FormFolderSummary | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const { canRename, canDelete } = useFolderPermissions();
  const folders = useQuery({
    queryKey: ["form-folders"],
    queryFn: async () => (await apiClient.get<FormFolderSummary[]>("/document-folders/form-folders")).data,
  });
  const documents = useQuery({
    queryKey: ["document-folders"],
    enabled: deleteTarget != null,
    queryFn: async () => (await apiClient.get<BrowseFolder[]>("/document-folders")).data,
  });

  const rename = useMutation({
    mutationFn: async ({ formKey, name }: { formKey: string; name: string }) =>
      (await apiClient.patch<FormFolderSummary>(`/document-folders/form-folders/${encodeURIComponent(formKey)}`, { name })).data,
    onMutate: async ({ formKey, name }) => {
      await qc.cancelQueries({ queryKey: ["form-folders"] });
      const previous = qc.getQueryData<FormFolderSummary[]>(["form-folders"]);
      qc.setQueryData<FormFolderSummary[]>(["form-folders"], (current) => current?.map((folder) => (folder.formKey === formKey || folder.formKeys?.includes(formKey) ? { ...folder, name } : folder)));
      return { previous };
    },
    onError: async (err, _vars, context) => {
      if (context?.previous) qc.setQueryData(["form-folders"], context.previous);
      toast.error(await extractErrorMessageAsync(err, "Couldn't rename that folder."));
    },
    onSuccess: () => {
      toast.success("Folder renamed.");
      setRenameTarget(null);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["form-folders"] });
    },
  });

  const retire = useMutation({
    mutationFn: async ({ formKey, destinationId }: { formKey: string; destinationId: number | null }) =>
      apiClient.post(`/document-folders/form-folders/${encodeURIComponent(formKey)}/retire`, { destinationId }),
    onMutate: async ({ formKey }) => {
      await qc.cancelQueries({ queryKey: ["form-folders"] });
      const previous = qc.getQueryData<FormFolderSummary[]>(["form-folders"]);
      qc.setQueryData<FormFolderSummary[]>(["form-folders"], (current) => current?.filter((folder) => folder.formKey !== formKey && !folder.formKeys?.includes(formKey)));
      return { previous };
    },
    onError: async (err, _vars, context) => {
      if (context?.previous) qc.setQueryData(["form-folders"], context.previous);
      toast.error(await extractErrorMessageAsync(err, "Couldn't delete that folder."));
    },
    onSuccess: () => {
      toast.success("Folder deleted.");
      setDeleteTarget(null);
      setSelectedKey(null);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["form-folders"] });
      void qc.invalidateQueries({ queryKey: ["document-folders"] });
    },
  });

  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => {
    return (folders.data ?? []).filter((folder) => {
      if (!needle) return true;
      return `${folder.name} ${folder.title} ${folder.formId} ${folder.formKey}`.toLowerCase().includes(needle);
    });
  }, [folders.data, needle]);
  const selected = visible.find((folder) => folder.formKey === selectedKey) ?? null;
  const pending = rename.isPending || retire.isPending;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Folders</h1>
          <p className="text-sm text-muted-foreground">
            One folder for each form you can fill in. Open a folder to see the saved copies of that form. Blank templates are in Blank Forms Templates in Folder Explorer.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="edit-folders"
            onClick={() => setEditingMode((current) => !current)}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted"
          >
            {editingMode ? "Done" : "Edit folders"}
          </button>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a form"
            aria-label="Find a form"
            className="w-56 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
      </div>

      {selected && (canRename || canDelete) && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
          <span className="text-sm font-medium">{selected.name}</span>
          <FolderActionButtons
            canRename={canRename}
            canDelete={canDelete}
            pending={pending}
            onEdit={() => setRenameTarget(selected)}
            onDelete={() => setDeleteTarget(selected)}
          />
        </div>
      )}

      {folders.isLoading && <p className="text-sm text-muted-foreground">Loading folders…</p>}
      {folders.isError && <p className="text-sm text-destructive">Couldn't load folders.</p>}
      {!folders.isLoading && !folders.isError && visible.length === 0 && <p className="text-sm text-muted-foreground">No forms match.</p>}

      {visible.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-card" data-testid="form-folders-list">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-1.5 font-medium">Form</th>
                <th className="px-3 py-1.5 text-right font-medium">Saved</th>
                {editingMode && <th className="px-3 py-1.5 text-right font-medium"> </th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((folder) => {
                const picked = selectedKey === folder.formKey;
                return (
                  <tr
                    key={folder.formKey}
                    data-selected={picked ? "true" : "false"}
                    className={`border-b border-border last:border-b-0 ${picked ? "bg-primary/10" : ""}`}
                    onClick={() => setSelectedKey(folder.formKey)}
                  >
                    <td className="px-3 py-1.5">
                      <Link
                        to={`/form-folders/${encodeURIComponent(folder.formKey)}`}
                        data-testid="form-folder"
                        data-form-key={folder.formKey}
                        className="inline-flex min-w-0 items-center gap-2 font-medium text-primary hover:underline"
                      >
                        <Folder size={16} className="shrink-0 text-muted-foreground" />
                        <span className="truncate" title={folder.name}>{folder.name}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">{savedLabel(folder.savedCount)}</td>
                    {editingMode && (
                      <td className="px-3 py-1.5 text-right">
                        <FolderActionButtons
                          canRename={canRename}
                          canDelete={canDelete}
                          pending={pending}
                          onEdit={() => setRenameTarget(folder)}
                          onDelete={() => setDeleteTarget(folder)}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <RenameFolderDialog
        open={renameTarget != null}
        name={renameTarget?.name ?? ""}
        pending={rename.isPending}
        onClose={() => {
          if (!rename.isPending) setRenameTarget(null);
        }}
        onSave={(name) => {
          if (renameTarget) rename.mutate({ formKey: renameTarget.formKey, name });
        }}
      />
      <DeleteFolderDialog
        open={deleteTarget != null}
        folderName={deleteTarget?.name ?? ""}
        folderId={null}
        folders={documents.data ?? []}
        savedCount={deleteTarget?.savedCount ?? 0}
        pending={retire.isPending}
        blockBlankLibrary
        onClose={() => {
          if (!retire.isPending) setDeleteTarget(null);
        }}
        onConfirm={(destinationId) => {
          if (deleteTarget) retire.mutate({ formKey: deleteTarget.formKey, destinationId });
        }}
      />
    </div>
  );
}

/** Saved filled copies of one form, newest save date first. */
export function FormFolderDetailPage() {
  const { formKey = "" } = useParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const { canRename, canDelete } = useFolderPermissions();
  const folder = useQuery({
    queryKey: ["form-folder", formKey],
    enabled: formKey.length > 0,
    queryFn: async () => (await apiClient.get<FormFolderDetail>(`/document-folders/form-folders/${encodeURIComponent(formKey)}`)).data,
  });
  const documents = useQuery({
    queryKey: ["document-folders"],
    enabled: deleting,
    queryFn: async () => (await apiClient.get<BrowseFolder[]>("/document-folders")).data,
  });

  const rename = useMutation({
    mutationFn: async (name: string) => (await apiClient.patch<FormFolderSummary>(`/document-folders/form-folders/${encodeURIComponent(formKey)}`, { name })).data,
    onMutate: async (name) => {
      await qc.cancelQueries({ queryKey: ["form-folder", formKey] });
      const previous = qc.getQueryData<FormFolderDetail>(["form-folder", formKey]);
      if (previous) qc.setQueryData<FormFolderDetail>(["form-folder", formKey], { ...previous, name });
      qc.setQueryData<FormFolderSummary[]>(["form-folders"], (current) => current?.map((row) => (row.formKey === formKey || row.formKeys?.includes(formKey) ? { ...row, name } : row)));
      return { previous };
    },
    onError: async (err, _name, context) => {
      if (context?.previous) qc.setQueryData(["form-folder", formKey], context.previous);
      toast.error(await extractErrorMessageAsync(err, "Couldn't rename that folder."));
    },
    onSuccess: () => {
      toast.success("Folder renamed.");
      setRenaming(false);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["form-folder", formKey] });
      void qc.invalidateQueries({ queryKey: ["form-folders"] });
    },
  });

  const retire = useMutation({
    mutationFn: async (destinationId: number | null) => apiClient.post(`/document-folders/form-folders/${encodeURIComponent(formKey)}/retire`, { destinationId }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["form-folders"] });
      const previous = qc.getQueryData<FormFolderSummary[]>(["form-folders"]);
      qc.setQueryData<FormFolderSummary[]>(["form-folders"], (current) => current?.filter((row) => row.formKey !== formKey && !row.formKeys?.includes(formKey)));
      return { previous };
    },
    onError: async (err, _vars, context) => {
      if (context?.previous) qc.setQueryData(["form-folders"], context.previous);
      toast.error(await extractErrorMessageAsync(err, "Couldn't delete that folder."));
    },
    onSuccess: () => {
      toast.success("Folder deleted.");
      setDeleting(false);
      navigate("/form-folders");
    },
  });

  const needle = query.trim().toLowerCase();
  const fills = useMemo(() => {
    const rows = folder.data?.fills ?? [];
    if (!needle) return rows;
    return rows.filter((fill) => fill.fileName.toLowerCase().includes(needle));
  }, [folder.data?.fills, needle]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm">
            <Link to="/form-folders" className="text-primary hover:underline">
              Folders
            </Link>
          </p>
          <h1 className="text-2xl font-semibold">{folder.data?.name ?? "Folder"}</h1>
          <p className="text-sm text-muted-foreground">Saved copies of this form, newest first. Blank templates are not listed here.</p>
        </div>
        <div className="flex items-center gap-2">
          <FolderActionButtons
            canRename={canRename}
            canDelete={canDelete}
            pending={rename.isPending || retire.isPending}
            onEdit={() => setRenaming(true)}
            onDelete={() => setDeleting(true)}
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a file"
            aria-label="Find a file"
            className="w-56 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
      </div>

      {folder.isLoading && <p className="text-sm text-muted-foreground">Loading saved forms…</p>}
      {folder.isError && <p className="text-sm text-destructive">Couldn't load this folder.</p>}
      {!folder.isLoading && !folder.isError && fills.length === 0 && <p className="text-sm text-muted-foreground">No saved copies of this form yet.</p>}

      {fills.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm" data-testid="saved-fills">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-1.5 font-medium">File name</th>
                <th className="px-3 py-1.5 font-medium">Saved</th>
                <th className="px-3 py-1.5 font-medium">Documents</th>
              </tr>
            </thead>
            <tbody>
              {fills.map((fill) => (
                <tr key={`${fill.recordId}-${fill.fileName}`} data-testid="saved-fill" data-file-name={fill.fileName} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-1.5">
                    <Link to={fill.openPath} title={fill.fileName} className="block max-w-full truncate font-medium text-primary hover:underline">
                      {fill.fileName}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    <time dateTime={fill.savedAt}>{formatDateTime(fill.savedAt)}</time>
                  </td>
                  <td className="px-3 py-1.5">
                    {fill.documentsFolderId != null ? (
                      <Link to={documentsFolderHref(fill.documentsFolderId)} className="text-primary hover:underline">
                        In Documents
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RenameFolderDialog
        open={renaming}
        name={folder.data?.name ?? ""}
        pending={rename.isPending}
        onClose={() => {
          if (!rename.isPending) setRenaming(false);
        }}
        onSave={(name) => rename.mutate(name)}
      />
      <DeleteFolderDialog
        open={deleting}
        folderName={folder.data?.name ?? "Folder"}
        folderId={null}
        folders={documents.data ?? []}
        savedCount={folder.data?.fills.length ?? 0}
        pending={retire.isPending}
        blockBlankLibrary
        onClose={() => {
          if (!retire.isPending) setDeleting(false);
        }}
        onConfirm={(destinationId) => retire.mutate(destinationId)}
      />
    </div>
  );
}
