import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { FORM_TEMPLATES_QUERY_KEY, useFormTemplates } from "../../api/formTemplatesQuery";
import { useCurrentUser } from "../../hooks/useAuth";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { EDITABLE_FORM_KEYS, FILEABLE_FORM_KEYS, canEditFormNumber } from "../../lib/formDocument";
import { documentsFolderHref, filingLocation, SAVED_FORM_FOLDERS_ROOT, type BrowseFolder, type FiledLocation } from "../../lib/folderBrowse";
import { defaultSaveDestination, type FormFolderChoice } from "../../lib/saveDestination";
import { SaveAsFolderDialog } from "./SaveAsFolderDialog";

export type { FiledLocation };
export type SaveResultState = FiledLocation | "saved" | "unfiled" | "error" | "file-error" | null;

interface FolderRow extends BrowseFolder {
  id: number;
  name: string;
  parentId: number | null;
  sortOrder: number;
}

export interface FormFilingView {
  formKey: string;
  recordId: number;
  formNumber: string;
  snapshotted: boolean;
  folderNodeId: number | null;
  parentId: number | null;
  parentPath: string[];
  suggestedFolderId: number | null;
  suggestedPath: string[];
  fileName: string | null;
}

function folderChoiceKey(formKey: string, recordId: number) {
  return ["form-folder-choice", formKey, recordId] as const;
}

/** The folder shown in Save to folder. An empty string means the user cleared it. */
export function rememberFolderChoice(queryClient: QueryClient, formKey: string, recordId: number, folderId: number | "") {
  queryClient.setQueryData(folderChoiceKey(formKey, recordId), folderId);
}

const ISO_DOCUMENTS_FOLDER = "ISO Compliance Documents";

function locationOf(view: FormFilingView, formKey: string): FiledLocation | null {
  const location = filingLocation(view.parentId, view.parentPath, view.fileName);
  if (!location || !view.parentPath.includes(SAVED_FORM_FOLDERS_ROOT)) return location;
  const visible = view.parentPath.filter((name) => name !== SAVED_FORM_FOLDERS_ROOT && name !== ISO_DOCUMENTS_FOLDER);
  return {
    ...location,
    path: visible.join(" / ") || location.path,
    href: `/form-folders/${encodeURIComponent(formKey)}`,
  };
}

/**
 * Files this filled copy in the folder currently chosen. A cleared choice does not fall back to the suggestion.
 * Returns the folder so the save message can open it. Null when no folder is chosen.
 */
export async function fileChosenFolder(queryClient: QueryClient, formKey: string, recordId: number): Promise<FiledLocation | null> {
  const stored = queryClient.getQueryData<number | "">(folderChoiceKey(formKey, recordId));
  let current = queryClient.getQueryData<FormFilingView>(["form-filing", formKey, recordId]);
  if (!current && FILEABLE_FORM_KEYS.has(formKey)) {
    current = (await apiClient.get<FormFilingView>("/document-folders/form-filings", { params: { formKey, recordId } })).data;
    queryClient.setQueryData(["form-filing", formKey, recordId], current);
  }
  if (stored === "") return null;
  if (typeof stored === "number") {
    if (current?.parentId === stored) return locationOf(current, formKey);
    const saved = (await apiClient.post<FormFilingView>("/document-folders/form-filings", { formKey, recordId, folderId: stored })).data;
    queryClient.setQueryData(["form-filing", formKey, recordId], saved);
    await queryClient.invalidateQueries({ queryKey: ["form-filing", formKey, recordId] });
    await queryClient.invalidateQueries({ queryKey: ["document-folders"] });
    await queryClient.invalidateQueries({ queryKey: ["form-folders"] });
    return locationOf(saved, formKey);
  }
  if (current?.parentId != null) return locationOf(current, formKey);
  try {
    const saved = (await apiClient.post<FormFilingView>("/document-folders/form-filings", { formKey, recordId, formFolderKey: formKey })).data;
    queryClient.setQueryData(["form-filing", formKey, recordId], saved);
    await queryClient.invalidateQueries({ queryKey: ["form-filing", formKey, recordId] });
    await queryClient.invalidateQueries({ queryKey: ["document-folders"] });
    await queryClient.invalidateQueries({ queryKey: ["form-folders"] });
    return locationOf(saved, formKey);
  } catch {
    const folderId = current?.suggestedFolderId ?? null;
    if (folderId == null) return null;
    const saved = (await apiClient.post<FormFilingView>("/document-folders/form-filings", { formKey, recordId, folderId })).data;
    queryClient.setQueryData(["form-filing", formKey, recordId], saved);
    await queryClient.invalidateQueries({ queryKey: ["form-filing", formKey, recordId] });
    await queryClient.invalidateQueries({ queryKey: ["document-folders"] });
    return locationOf(saved, formKey);
  }
}

/** The line under Save: the folder path opens that folder in Documents. */
export function SaveResult({ result }: { result: SaveResultState }) {
  if (result == null) return null;
  if (result === "saved") return <span className="text-xs text-muted-foreground">Saved</span>;
  if (result === "error") return <span className="text-xs text-destructive">Couldn't save this form.</span>;
  if (result === "file-error") {
    return <span className="text-xs text-destructive">The form was saved, but it could not be filed in that folder.</span>;
  }
  if (result === "unfiled") {
    return (
      <span className="text-xs text-muted-foreground" data-testid="save-location">
        Saved. Choose a folder to file this copy.
      </span>
    );
  }
  const href = result.href ?? documentsFolderHref(result.folderId);
  return (
    <span className="text-xs text-muted-foreground" data-testid="save-location">
      Saved in{" "}
      <Link to={href} className="text-primary hover:underline">
        {result.path}
      </Link>
      {" · "}
      <Link to={href} className="text-primary hover:underline">
        Open folder
      </Link>
    </span>
  );
}

function useCanControlDocuments() {
  const user = useCurrentUser();
  const { effective } = useEffectivePermissions();
  const role = user?.roleName;
  return role === "admin" || role === "owner" || role === "quality_manager" || effective?.documents === "edit";
}

export function useFormFiling(formKey: string | null, recordId: number) {
  return useQuery({
    queryKey: ["form-filing", formKey, recordId],
    enabled: !!formKey && FILEABLE_FORM_KEYS.has(formKey) && recordId > 0,
    queryFn: async () =>
      (await apiClient.get<FormFilingView>("/document-folders/form-filings", { params: { formKey, recordId } })).data,
  });
}

/** Sets the document number on the blank master. Filled copies keep the number they were given. */
export function FormNumberEditor({ formKey, compact = false }: { formKey: string; compact?: boolean }) {
  const user = useCurrentUser();
  const canEdit = canEditFormNumber(user);
  const queryClient = useQueryClient();
  const templates = useFormTemplates({ enabled: formKey.length > 0 });
  const current = templates.data?.find((item) => item.formKey === formKey)?.formId ?? "";
  const [value, setValue] = useState(current);
  const [seen, setSeen] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (seen === current) return;
    setValue(current);
    setSeen(current);
  }, [current, seen]);

  const save = useMutation({
    mutationFn: async (formId: string) => (await apiClient.patch(`/document-folders/form-templates/${formKey}`, { formId })).data,
    onSuccess: async () => {
      setMessage("Saved. The blank master and Forms Library use this number from now on.");
      await queryClient.invalidateQueries({ queryKey: FORM_TEMPLATES_QUERY_KEY });
    },
    onError: () => setMessage("Couldn't save the form number."),
  });

  if (!canEdit) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="form-number-readonly" data-form-key={formKey}>
        Form number <span className="text-sm text-foreground">{current.trim() || "None"}</span>
      </p>
    );
  }

  return (
    <form
      className="no-print flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage(null);
        save.mutate(value.trim());
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Form number
        <input
          data-testid="form-number-input"
          data-form-key={formKey}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={40}
          placeholder="Blank until you set one"
          className="w-56 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={save.isPending} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60">
          {save.isPending ? "Saving…" : "Save number"}
        </button>
        {compact ? null : <span className="text-xs text-muted-foreground">Filled copies keep the number they were given. Leave this blank to show no number.</span>}
      </div>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </form>
  );
}

/** Pick any Documents folder for this filled copy. The subject folder starts selected. */
export function RecordFolderField({ formKey, recordId, prepare }: { formKey: string; recordId: number; prepare?: () => Promise<unknown> | unknown }) {
  const canEdit = useCanControlDocuments();
  const queryClient = useQueryClient();
  const filing = useFormFiling(formKey, recordId);
  const folders = useQuery({
    queryKey: ["document-folders"],
    queryFn: async () => (await apiClient.get<FolderRow[]>("/document-folders")).data,
    enabled: FILEABLE_FORM_KEYS.has(formKey),
  });
  const formFolders = useQuery({
    queryKey: ["form-folders"],
    queryFn: async () => (await apiClient.get<FormFolderChoice[]>("/document-folders/form-folders")).data,
    enabled: FILEABLE_FORM_KEYS.has(formKey),
  });
  const [selected, setSelected] = useState<number | "">("");
  const [synced, setSynced] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const signature = `${filing.data?.parentId ?? ""}:${(filing.data?.parentPath ?? []).join("/")}`;

  useEffect(() => {
    if (!filing.data || synced === signature) return;
    const inDocuments = filing.data.parentId != null && !filing.data.parentPath.includes(SAVED_FORM_FOLDERS_ROOT);
    const next = inDocuments ? filing.data.parentId! : "";
    setSelected(next === "" ? "" : next);
    if (typeof next === "number") rememberFolderChoice(queryClient, formKey, recordId, next);
    setSynced(signature);
  }, [filing.data, formKey, queryClient, recordId, signature, synced]);

  const file = useMutation({
    mutationFn: async (body: { folderId?: number; formFolderKey?: string; partNumber?: string }) =>
      (await apiClient.post<FormFilingView>("/document-folders/form-filings", { formKey, recordId, ...body })).data,
    onSuccess: async (saved) => {
      setMessage(null);
      setPickerOpen(false);
      const parent = saved.parentId;
      if (parent != null && !saved.parentPath.includes(SAVED_FORM_FOLDERS_ROOT)) {
        rememberFolderChoice(queryClient, formKey, recordId, parent);
        setSelected(parent);
      } else {
        setSelected("");
      }
      await queryClient.invalidateQueries({ queryKey: ["form-filing", formKey, recordId] });
      await queryClient.invalidateQueries({ queryKey: ["document-folders"] });
      await queryClient.invalidateQueries({ queryKey: ["form-folders"] });
    },
    onError: () => setMessage("Couldn't file this record."),
  });

  if (!FILEABLE_FORM_KEYS.has(formKey)) return null;

  const filed = (filing.data?.parentPath.length ?? 0) > 0;
  const tree = (folders.data ?? []).map((folder) => ({ ...folder, sortOrder: folder.sortOrder ?? 0 }));
  const destination = defaultSaveDestination({
    formKey,
    folders: formFolders.data ?? [],
    filedParentId: filing.data?.parentId ?? null,
    filedParentPath: filing.data?.parentPath ?? [],
  });
  const filedInFormFolder = (filing.data?.parentPath ?? []).includes(SAVED_FORM_FOLDERS_ROOT);
  const filedHref =
    filed && filing.data?.parentId != null
      ? filedInFormFolder
        ? `/form-folders/${encodeURIComponent(formKey)}`
        : documentsFolderHref(filing.data.parentId)
      : "";
  const filedLabel = filedInFormFolder
    ? (filing.data?.parentPath ?? []).filter((name) => name !== SAVED_FORM_FOLDERS_ROOT && name !== "ISO Compliance Documents").join(" / ")
    : (filing.data?.parentPath ?? []).join(" / ");

  return (
    <div className="no-print flex flex-col gap-1" data-testid="folder-destination">
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        Save as
        {canEdit ? (
          <button type="button" data-testid="save-as" onClick={() => setPickerOpen(true)} className="w-fit rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted">
            Save as
          </button>
        ) : (
          <span className="text-sm text-foreground">
            {filed && filing.data?.parentId != null ? (
              <Link to={filedHref} className="text-primary hover:underline">
                {filedLabel}
              </Link>
            ) : (
              "Not filed yet"
            )}
          </span>
        )}
      </div>
      {pickerOpen && canEdit && (
        <SaveAsFolderDialog
          key={`${destination?.kind === "form" ? destination.formKey : ""}:${destination?.kind === "documents" ? destination.folderId : ""}`}
          folders={tree}
          formFolders={formFolders.data ?? []}
          defaultFormFolderKey={destination?.kind === "form" ? destination.formKey : ""}
          selectedId={destination?.kind === "documents" ? destination.folderId : selected}
          pending={file.isPending}
          onClose={() => setPickerOpen(false)}
          onSave={(folderId, partNumber) => {
            setMessage(null);
            void (async () => {
              try {
                if (prepare) await prepare();
                file.mutate({ folderId, partNumber });
              } catch {
                setMessage("Couldn't file this record.");
              }
            })();
          }}
          onSaveFormFolder={(formFolderKey, partNumber) => {
            setMessage(null);
            void (async () => {
              try {
                if (prepare) await prepare();
                file.mutate({ formFolderKey, partNumber });
              } catch {
                setMessage("Couldn't file this record.");
              }
            })();
          }}
        />
      )}
      {destination?.kind === "form" && (
        <p className="text-xs text-muted-foreground">Saves in {destination.name} unless you pick a Documents folder.</p>
      )}
      {filed && filing.data?.parentId != null && (
        <p className="text-xs text-muted-foreground">
          Filed in{" "}
          <Link to={filedHref} className="text-primary hover:underline">
            {filedLabel}
          </Link>
          {filing.data.fileName ? ` · ${filing.data.fileName}` : ""}
          {" · "}
          <Link to={filedHref} className="text-primary hover:underline">
            Open folder
          </Link>
        </p>
      )}
      {canEdit && <p className="text-xs text-muted-foreground">Save as files this copy in the folder you pick. The blank stays reusable.</p>}
      {message === "Couldn't file this record." && <p className="text-xs text-destructive">{message}</p>}
    </div>
  );
}
