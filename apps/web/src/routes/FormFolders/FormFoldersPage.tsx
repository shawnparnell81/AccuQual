import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Folder } from "lucide-react";
import { apiClient } from "../../api/client";
import { documentsFolderHref } from "../../lib/folderBrowse";
import { formatDateTime } from "../../lib/dates";

interface FormFolderSummary {
  formKey: string;
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
  title: string;
  formId: string;
  name: string;
  fills: SavedFill[];
}

function savedLabel(count: number): string {
  return count === 1 ? "1 saved" : `${count} saved`;
}

/** Form-name folders. Each one opens the saved copies of that form. */
export function FormFoldersPage() {
  const [query, setQuery] = useState("");
  const folders = useQuery({
    queryKey: ["form-folders"],
    queryFn: async () => (await apiClient.get<FormFolderSummary[]>("/document-folders/form-folders")).data,
  });

  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => {
    return (folders.data ?? []).filter((folder) => {
      if (!needle) return true;
      return `${folder.name} ${folder.title} ${folder.formId} ${folder.formKey}`.toLowerCase().includes(needle);
    });
  }, [folders.data, needle]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Folders</h1>
          <p className="text-sm text-muted-foreground">
            One folder for each form you can fill in. Open a folder to see the saved copies of that form. Blank templates stay on Blank Forms.
          </p>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a form"
          aria-label="Find a form"
          className="w-56 rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

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
              </tr>
            </thead>
            <tbody>
              {visible.map((folder) => (
                <tr key={folder.formKey} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-1.5">
                    <Link
                      to={`/form-folders/${encodeURIComponent(folder.formKey)}`}
                      data-testid="form-folder"
                      data-form-key={folder.formKey}
                      className="inline-flex min-w-0 items-center gap-2 font-medium text-primary hover:underline"
                    >
                      <Folder size={16} className="shrink-0 text-muted-foreground" />
                      <span className="truncate">{folder.name}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground">{savedLabel(folder.savedCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Saved filled copies of one form, newest save date first. */
export function FormFolderDetailPage() {
  const { formKey = "" } = useParams();
  const [query, setQuery] = useState("");
  const folder = useQuery({
    queryKey: ["form-folder", formKey],
    enabled: formKey.length > 0,
    queryFn: async () => (await apiClient.get<FormFolderDetail>(`/document-folders/form-folders/${encodeURIComponent(formKey)}`)).data,
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
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a file"
          aria-label="Find a file"
          className="w-56 rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
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
                    <Link to={fill.openPath} className="font-medium text-primary hover:underline">
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
    </div>
  );
}
