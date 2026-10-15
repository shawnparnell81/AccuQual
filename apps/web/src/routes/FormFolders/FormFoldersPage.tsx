import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { blankOpenPath, NO_FOLDER_BLANK_KEYS } from "../../lib/retiredBlanks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Folder } from "lucide-react";
import { apiClient } from "../../api/client";
import { FormRevisionHistory } from "../../components/forms/FormRevisionHistory";
import { ExplorerCatalog } from "../../components/documents/ExplorerCatalog";
import { ExplorerViewSwitcher } from "../../components/documents/ExplorerViewSwitcher";
import { FileThumbnail } from "../../components/documents/FileThumbnail";
import { DeleteFolderDialog, FolderActionButtons, RenameFolderDialog } from "../../components/documents/FolderNameDialogs";
import { useToast } from "../../components/shared/ToastProvider";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { extractErrorMessageAsync } from "../../hooks/useWorkflowAction";
import { documentsFolderHref, type BrowseFolder } from "../../lib/folderBrowse";
import { fileThumbnailKind } from "../../lib/explorerView";
import { formatDateTime } from "../../lib/dates";
import { useExplorerView } from "../../hooks/useExplorerView";
import { useFormTemplates } from "../../api/formTemplatesQuery";
import { blankFormFileName, blankTemplatesForFolder } from "../../lib/blankFormsList";

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
  const [view, setView] = useExplorerView("form-folders");
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
        <div className="flex flex-wrap items-center gap-2">
          <ExplorerViewSwitcher view={view} onChange={setView} />
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
        <ExplorerCatalog
          items={visible}
          view={view}
          testId="form-folders-list"
          title={(folder) => folder.name}
          icon={() => <Folder size={view === "small" ? 28 : 16} className="text-primary" aria-hidden />}
          largeVisual={() => <Folder size={40} className="text-primary" aria-hidden />}
          href={(folder) => `/form-folders/${encodeURIComponent(folder.formKey)}`}
          onRowClick={(folder) => setSelectedKey(folder.formKey)}
          selected={(folder) => selectedKey === folder.formKey}
          itemTestId={() => "form-folder"}
          itemAttrs={(folder) => ({ "data-form-key": folder.formKey, "data-selected": selectedKey === folder.formKey ? "true" : "false" })}
          columns={[
            { key: "formId", label: "Form ID", render: (folder) => folder.formId || "—" },
            { key: "title", label: "Title", render: (folder) => <span title={folder.title}>{folder.title}</span> },
            { key: "saved", label: "Saved", align: "right", render: (folder) => savedLabel(folder.savedCount) },
          ]}
          trailing={
            editingMode
              ? (folder) => (
                  <FolderActionButtons
                    canRename={canRename}
                    canDelete={canDelete}
                    pending={pending}
                    onEdit={() => setRenameTarget(folder)}
                    onDelete={() => setDeleteTarget(folder)}
                  />
                )
              : undefined
          }
        />
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
  // A retired-folder blank has no saved-copies folder on the API. Open the blank instead of "Couldn't load this folder."
  if (NO_FOLDER_BLANK_KEYS.has(formKey)) return <Navigate to={blankOpenPath(formKey)} replace />;
  return <FormFolderDetailBody formKey={formKey} />;
}

function FormFolderDetailBody({ formKey }: { formKey: string }) {
  const navigate = useNavigate();
  const [view, setView] = useExplorerView("form-folder");
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
      navigate("/blank-forms");
    },
  });

  const templates = useFormTemplates();
  const blanks = blankTemplatesForFolder(templates.data ?? [], folder.data?.formKeys ?? (folder.data ? [folder.data.formKey] : []));

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
            <Link to="/blank-forms" className="text-primary hover:underline">
              Blank Forms
            </Link>
          </p>
          <h1 className="text-2xl font-semibold">{folder.data?.name ?? "Folder"}</h1>
          <p className="text-sm text-muted-foreground">The blank template is pinned at the top. Open it to start a new copy; saving files the copy in this folder. Saved copies follow, newest first.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExplorerViewSwitcher view={view} onChange={setView} />
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

      {blanks.length > 0 && (
        <div className="rounded-lg border border-border bg-card text-sm" role="list" data-testid="folder-blank-templates">
          {blanks.map((blank) => (
            <div
              key={blank.formKey}
              role="listitem"
              data-testid="folder-blank-template"
              data-form-key={blank.formKey}
              tabIndex={0}
              className="flex cursor-default items-center gap-2 border-b border-border px-3 py-1.5 last:border-b-0 hover:bg-muted focus:bg-primary/10 outline-none"
              onDoubleClick={() => navigate(blank.start ? `/blank-forms/start/${blank.formKey}` : blank.subjectRoute)}
              onKeyDown={(event) => {
                if (event.key === "Enter") navigate(blank.start ? `/blank-forms/start/${blank.formKey}` : blank.subjectRoute);
              }}
            >
              <FileText size={16} className="shrink-0 text-primary" aria-hidden />
              <Link
                to={blank.start ? `/blank-forms/start/${blank.formKey}` : blank.subjectRoute}
                className="min-w-0 flex-1 truncate font-medium text-primary hover:underline"
              >
                {blankFormFileName(blank)}
              </Link>
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Blank template</span>
            </div>
          ))}
        </div>
      )}

      <FormRevisionHistory formKey={folder.data?.formKey ?? formKey} />

      {folder.isLoading && <p className="text-sm text-muted-foreground">Loading saved forms…</p>}
      {folder.isError && <p className="text-sm text-destructive">Couldn't load this folder.</p>}
      {!folder.isLoading && !folder.isError && fills.length === 0 && <p className="text-sm text-muted-foreground">No saved copies of this form yet.</p>}

      {fills.length > 0 && (
        <ExplorerCatalog
          items={fills}
          view={view}
          testId="saved-fills"
          title={(fill) => fill.fileName}
          icon={() => <FileText size={view === "small" ? 28 : 16} className="text-primary" aria-hidden />}
          largeVisual={(fill) => {
            const fallback = <FileText size={40} className="text-primary" aria-hidden />;
            if (fill.documentsFolderId == null || fileThumbnailKind(fill.fileName) === "none") return fallback;
            return <FileThumbnail folderId={fill.documentsFolderId} fileName={fill.fileName} fallback={fallback} />;
          }}
          href={(fill) => fill.openPath}
          itemTestId={() => "saved-fill"}
          itemAttrs={(fill) => ({ "data-file-name": fill.fileName })}
          columns={[
            {
              key: "saved",
              label: "Saved",
              render: (fill) => <time dateTime={fill.savedAt}>{formatDateTime(fill.savedAt)}</time>,
            },
            {
              key: "documents",
              label: "Documents",
              render: (fill) =>
                fill.documentsFolderId != null ? (
                  <Link to={documentsFolderHref(fill.documentsFolderId)} className="text-primary hover:underline" data-row-chrome="">
                    In Documents
                  </Link>
                ) : (
                  "—"
                ),
            },
          ]}
        />
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
