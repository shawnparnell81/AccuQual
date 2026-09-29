import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useCurrentUser } from "../../hooks/useAuth";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { EDITABLE_FORM_KEYS } from "../../lib/formDocument";

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

function useCanControlDocuments() {
  const user = useCurrentUser();
  const { effective } = useEffectivePermissions();
  const role = user?.roleName;
  return role === "admin" || role === "owner" || role === "quality_manager" || effective?.documents === "edit";
}

export function useFormFiling(formKey: string | null, recordId: number) {
  return useQuery({
    queryKey: ["form-filing", formKey, recordId],
    enabled: !!formKey && EDITABLE_FORM_KEYS.has(formKey) && recordId > 0,
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
  const canEdit = useCanControlDocuments();
  const queryClient = useQueryClient();
  const templates = useQuery({
    queryKey: ["form-number", formKey],
    queryFn: async () => (await apiClient.get<{ templates: { formKey: string; formId: string }[] }>("/document-folders/form-templates")).data.templates,
    enabled: EDITABLE_FORM_KEYS.has(formKey),
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

  if (!EDITABLE_FORM_KEYS.has(formKey) || !canEdit) return null;

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
    enabled: EDITABLE_FORM_KEYS.has(formKey),
  });
  const [selected, setSelected] = useState<number | "">("");
  const [synced, setSynced] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const signature = `${filing.data?.parentId ?? ""}:${filing.data?.suggestedFolderId ?? ""}`;

  useEffect(() => {
    if (!filing.data || synced === signature) return;
    const next = filing.data.parentId ?? filing.data.suggestedFolderId ?? "";
    setSelected(next === "" ? "" : next);
    setSynced(signature);
  }, [filing.data, signature, synced]);

  const file = useMutation({
    mutationFn: async (folderId: number) =>
      (await apiClient.post<FormFilingView>("/document-folders/form-filings", { formKey, recordId, folderId })).data,
    onSuccess: async (saved) => {
      setMessage(saved.parentPath.length > 0 ? `Filed in ${saved.parentPath.join(" / ")}` : "Filed");
      await queryClient.invalidateQueries({ queryKey: ["form-filing", formKey, recordId] });
      await queryClient.invalidateQueries({ queryKey: ["document-folders"] });
    },
    onError: () => setMessage("Couldn't file this record."),
  });

  if (!EDITABLE_FORM_KEYS.has(formKey)) return null;

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
            onChange={(event) => setSelected(event.target.value === "" ? "" : Number(event.target.value))}
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
          <span className="text-sm text-foreground">{filed ? filing.data?.parentPath.join(" / ") : "Not filed yet"}</span>
        )}
      </label>
      {filing.data && filing.data.suggestedPath.length > 0 && (
        <p className="text-xs text-muted-foreground">Suggested: {filing.data.suggestedPath.join(" / ")}</p>
      )}
      {filed && <p className="text-xs text-muted-foreground">Filed in {filing.data?.parentPath.join(" / ")}{filing.data?.fileName ? ` · ${filing.data.fileName}` : ""}</p>}
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
          <span className="text-xs text-muted-foreground">Pick any Documents folder, including a subject folder or ISO Compliance. You can move it later.</span>
        </div>
      )}
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
