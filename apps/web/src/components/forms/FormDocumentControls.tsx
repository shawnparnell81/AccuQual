import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useCurrentUser } from "../../hooks/useAuth";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { EDITABLE_FORM_KEYS, FILEABLE_FORM_KEYS, canEditFormNumber } from "../../lib/formDocument";
import { documentsFolderHref, filingLocation, type FiledLocation } from "../../lib/folderBrowse";

export type { FiledLocation };
export type SaveResultState = FiledLocation | "saved" | "unfiled" | "error" | "file-error" | null;

interface FolderRow {
  id: number;
  name: string;
  parentId: number | null;
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

function locationOf(view: FormFilingView): FiledLocation | null {
  return filingLocation(view.parentId, view.parentPath, view.fileName);
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
  const folderId = typeof stored === "number" ? stored : stored === "" ? null : (current?.parentId ?? current?.suggestedFolderId ?? null);
  if (folderId == null) return null;
  if (current?.parentId === folderId) return locationOf(current);
  const saved = (await apiClient.post<FormFilingView>("/document-folders/form-filings", { formKey, recordId, folderId })).data;
  queryClient.setQueryData(["form-filing", formKey, recordId], saved);
  await queryClient.invalidateQueries({ queryKey: ["form-filing", formKey, recordId] });
  await queryClient.invalidateQueries({ queryKey: ["document-folders"] });
  return locationOf(saved);
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
  const href = documentsFolderHref(result.folderId);
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

function folderChoices(folders: FolderRow[], excludeId: number | null): { id: number; label: string }[] {
  const choices: { id: number; label: string }[] = [];
  function walk(parentId: number | null, prefix: string) {
    const children = folders.filter((folder) => folder.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));
    for (const folder of children) {
      if (folder.id === excludeId) continue;
      const label = prefix ? `${prefix} / ${folder.name}` : folder.name;
      choices.push({ id: folder.id, label });
      walk(folder.id, label);
    }
  }
  walk(null, "");
  return choices;
}

/** Sets the document number on the blank master. Filled copies keep the number they were given. */
export function FormNumberEditor({ formKey, compact = false }: { formKey: string; compact?: boolean }) {
  const user = useCurrentUser();
  const canEdit = canEditFormNumber(user);
  const queryClient = useQueryClient();
  const templates = useQuery({
    queryKey: ["form-number", formKey],
    queryFn: async () => (await apiClient.get<{ templates: { formKey: string; formId: string }[] }>("/document-folders/form-templates")).data.templates,
    enabled: formKey.length > 0,
  });
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
      await queryClient.invalidateQueries({ queryKey: ["form-templates"] });
      await queryClient.invalidateQueries({ queryKey: ["form-number", formKey] });
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
export function RecordFolderField({ formKey, recordId }: { formKey: string; recordId: number }) {
  const canEdit = useCanControlDocuments();
  const queryClient = useQueryClient();
  const filing = useFormFiling(formKey, recordId);
  const folders = useQuery({
    queryKey: ["document-folders"],
    queryFn: async () => (await apiClient.get<FolderRow[]>("/document-folders")).data,
    enabled: FILEABLE_FORM_KEYS.has(formKey),
  });
  const [selected, setSelected] = useState<number | "">("");
  const [synced, setSynced] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const signature = `${filing.data?.parentId ?? ""}:${filing.data?.suggestedFolderId ?? ""}`;

  useEffect(() => {
    if (!filing.data || synced === signature) return;
    const next = filing.data.parentId ?? filing.data.suggestedFolderId ?? "";
    setSelected(next === "" ? "" : next);
    rememberFolderChoice(queryClient, formKey, recordId, next === "" ? "" : next);
    setSynced(signature);
  }, [filing.data, formKey, queryClient, recordId, signature, synced]);

  const file = useMutation({
    mutationFn: async (folderId: number) =>
      (await apiClient.post<FormFilingView>("/document-folders/form-filings", { formKey, recordId, folderId })).data,
    onSuccess: async () => {
      setMessage(null);
      await queryClient.invalidateQueries({ queryKey: ["form-filing", formKey, recordId] });
      await queryClient.invalidateQueries({ queryKey: ["document-folders"] });
    },
    onError: () => setMessage("Couldn't file this record."),
  });

  if (!FILEABLE_FORM_KEYS.has(formKey)) return null;

  const choices = folderChoices(folders.data ?? [], filing.data?.folderNodeId ?? null);
  const filed = (filing.data?.parentPath.length ?? 0) > 0;
  const samePlace = filed && selected === filing.data?.parentId;

  return (
    <div className="no-print flex flex-col gap-1" data-testid="folder-destination">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Save to folder
        {canEdit ? (
          <select
            aria-label="Save to folder"
            value={selected}
            onChange={(event) => {
              const next = event.target.value === "" ? "" : Number(event.target.value);
              setSelected(next);
              rememberFolderChoice(queryClient, formKey, recordId, next);
            }}
            className="max-w-xl rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          >
            <option value="">Choose a folder</option>
            {choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm text-foreground">
            {filed && filing.data?.parentId != null ? (
              <Link to={documentsFolderHref(filing.data.parentId)} className="text-primary hover:underline">
                {filing.data.parentPath.join(" / ")}
              </Link>
            ) : (
              "Not filed yet"
            )}
          </span>
        )}
      </label>
      {filing.data && filing.data.suggestedPath.length > 0 && (
        <p className="text-xs text-muted-foreground">Suggested: {filing.data.suggestedPath.join(" / ")}</p>
      )}
      {filed && filing.data?.parentId != null && (
        <p className="text-xs text-muted-foreground">
          Filed in{" "}
          <Link to={documentsFolderHref(filing.data.parentId)} className="text-primary hover:underline">
            {filing.data.parentPath.join(" / ")}
          </Link>
          {filing.data.fileName ? ` · ${filing.data.fileName}` : ""}
          {" · "}
          <Link to={documentsFolderHref(filing.data.parentId)} className="text-primary hover:underline">
            Open folder
          </Link>
        </p>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={file.isPending || selected === "" || samePlace}
            onClick={() => {
              if (selected === "") return;
              setMessage(null);
              file.mutate(selected);
            }}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60"
          >
            {file.isPending ? "Saving…" : filed ? "Move" : "File here"}
          </button>
          <span className="text-xs text-muted-foreground">Pick any Documents folder. You can move it later. One copy stays in the folder you pick.</span>
        </div>
      )}
      {message === "Couldn't file this record." && <p className="text-xs text-destructive">{message}</p>}
    </div>
  );
}
