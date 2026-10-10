import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { SelectField, TextField } from "../../components/forms/Field";
import { SaveAsFolderDialog } from "../../components/forms/SaveAsFolderDialog";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useCurrentUser } from "../../hooks/useAuth";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { isFullAccessRole } from "../../lib/fullAccess";
import type { BrowseFolder } from "../../lib/folderBrowse";

interface ImportField {
  key: string;
  label: string;
  required?: boolean;
  help?: string;
}

interface ImportType {
  key: string;
  label: string;
  description: string;
  supportsInvites: boolean;
  archiveOnly?: boolean;
  fields: ImportField[];
}

interface ImportJob {
  id: number;
  entityKey: string;
  fileName: string;
  status: string;
  totalRows: number;
  processedRows: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  headers: string[] | null;
  sample: string[][] | null;
  problems: { row: number; label: string; messages: string[] }[];
  hasErrorReport: boolean;
  message: string | null;
  mapping: Record<string, number | null> | null;
  fields?: ImportField[];
  supportsInvites?: boolean;
  archiveOnly?: boolean;
  label?: string;
  savedMappingApplied?: boolean;
}

interface HistoryRow {
  id: number;
  entityKey: string;
  fileName: string;
  status: string;
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  message: string | null;
  startedByName: string | null;
  createdAt: string;
  hasErrorReport: boolean;
}

async function download(path: string, fileName: string) {
  const res = await apiClient.get(path, { responseType: "blob" });
  const url = URL.createObjectURL(res.data as Blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function defaultImportName(typeLabel: string): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${typeLabel} ${now.getFullYear()}-${month}-${day}`;
}

function folderPath(folders: BrowseFolder[], id: number): string {
  const names: string[] = [];
  let current = folders.find((folder) => folder.id === id);
  const seen = new Set<number>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId == null ? undefined : folders.find((folder) => folder.id === current!.parentId);
  }
  return names.join(" / ");
}

const DUPLICATE_OPTIONS = [
  { value: "skip", label: "Skip rows that already exist" },
  { value: "update", label: "Update existing records" },
  { value: "create_only", label: "Only add new records (existing ones are errors)" },
];

function ImportAccess({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  const { effective, isLoading } = useEffectivePermissions();
  if (isFullAccessRole(user?.roleName)) return <>{children}</>;
  if (isLoading) return <LoadingPlaceholder />;
  const level = effective?.import_data;
  if (level === "read" || level === "edit") return <>{children}</>;
  return <p className="text-sm text-muted-foreground">Importing data isn't turned on for your role. An administrator can add the import permission.</p>;
}

export function AdminImportPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const typesQuery = useQuery<{ maxBytes: number; types: ImportType[] }>({
    queryKey: ["admin-imports", "types"],
    queryFn: async () => (await apiClient.get("/admin/imports/types")).data,
  });
  const destination = useQuery<{ folderId: number; label: string }>({
    queryKey: ["admin-imports", "destination"],
    queryFn: async () => (await apiClient.get("/admin/imports/destination")).data,
  });
  const folders = useQuery<BrowseFolder[]>({
    queryKey: ["document-folders"],
    queryFn: async () => (await apiClient.get("/document-folders")).data,
  });
  const history = useQuery<HistoryRow[]>({
    queryKey: ["admin-imports", "history"],
    queryFn: async () => (await apiClient.get("/admin/imports")).data,
  });

  const [typeKey, setTypeKey] = useState("");
  const [job, setJob] = useState<ImportJob | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [badRowMode, setBadRowMode] = useState<"skip" | "fail">("skip");
  const [duplicateMode, setDuplicateMode] = useState("skip");
  const [sendInvites, setSendInvites] = useState(false);
  const [checked, setChecked] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [folderId, setFolderId] = useState<number | "">("");
  const [pickingFolder, setPickingFolder] = useState(false);

  function saveFile(path: string, fileName: string) {
    void download(path, fileName).catch((err) => toast.error(extractErrorMessage(err, "Couldn't download that file.")));
  }

  useEffect(() => {
    if (folderId === "" && destination.data?.folderId) setFolderId(destination.data.folderId);
  }, [destination.data, folderId]);

  const selected = typesQuery.data?.types.find((type) => type.key === typeKey);
  const maxMb = Math.round((typesQuery.data?.maxBytes ?? 50 * 1024 * 1024) / (1024 * 1024));
  const fields = job?.fields ?? selected?.fields ?? [];

  const live = useQuery<ImportJob>({
    queryKey: ["admin-imports", job?.id],
    queryFn: async () => (await apiClient.get(`/admin/imports/${job!.id}`)).data,
    enabled: job != null && (job.status === "running" || job.status === "checking"),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "checking" ? 1500 : false;
    },
  });
  const current = live.data ?? job;

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("entityKey", typeKey);
      body.append("file", file);
      return (await apiClient.post<ImportJob>("/admin/imports", body)).data;
    },
    onSuccess: (data) => {
      setJob(data);
      setMapping(data.mapping ?? {});
      setChecked(false);
      setSendInvites(false);
      setDisplayName(defaultImportName(data.label || selected?.label || "Import"));
      setFolderId(destination.data?.folderId ?? "");
      toast.success(data.savedMappingApplied ? "File received. Last month's column mapping was applied." : "File received. Match the columns, then check it before importing.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "That file couldn't be read.")),
  });

  const options = () => ({ mapping, badRowMode, duplicateMode, sendInvites, displayName: displayName.trim(), folderId: folderId === "" ? undefined : folderId });

  const check = useMutation({
    mutationFn: async () => (await apiClient.post<ImportJob>(`/admin/imports/${job!.id}/check`, options())).data,
    onSuccess: (data) => {
      setJob(data);
      setChecked(true);
      void queryClient.invalidateQueries({ queryKey: ["admin-imports", "history"] });
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't check that file.")),
  });

  const run = useMutation({
    mutationFn: async () => (await apiClient.post<ImportJob>(`/admin/imports/${job!.id}/run`, options())).data,
    onSuccess: (data) => {
      setJob(data);
      void queryClient.invalidateQueries({ queryKey: ["admin-imports", "history"] });
      if (data.status === "completed") toast.success(data.message || "Import finished.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't import that file.")),
  });

  function onFile(file: File | undefined) {
    if (!file || !typeKey) return;
    const limit = typesQuery.data?.maxBytes ?? 50 * 1024 * 1024;
    if (file.size > limit) {
      toast.error(`That file is larger than ${maxMb} MB. Split it into smaller files.`);
      return;
    }
    upload.mutate(file);
  }

  const busy = upload.isPending || check.isPending || run.isPending || current?.status === "running" || current?.status === "checking";
  const progress = current && current.totalRows > 0 ? Math.min(100, Math.round((current.processedRows / current.totalRows) * 100)) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Import data</h1>
        <p className="text-sm text-muted-foreground">Load a spreadsheet of suppliers, parts, inspections, or other quality records. Nothing is saved until you confirm the check.</p>
      </div>
      <ImportAccess>
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
          <SelectField
            label="What are you importing?"
            value={typeKey}
            onChange={(e) => {
              setTypeKey(e.target.value);
              setJob(null);
              setChecked(false);
            }}
          >
            <option value="">Choose a type</option>
            {(typesQuery.data?.types ?? []).map((type) => (
              <option key={type.key} value={type.key}>
                {type.label}
              </option>
            ))}
          </SelectField>
          {selected && <p className="text-sm text-muted-foreground">{selected.description}</p>}
          {selected && (
            <button type="button" className="w-fit text-sm text-primary hover:underline" onClick={() => saveFile(`/admin/imports/types/${selected.key}/template`, `${selected.key}-import-template.xlsx`)}>
              Download a blank template
            </button>
          )}

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-semibold text-muted-foreground">Spreadsheet</span>
            <input
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={!typeKey || busy}
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
              className="text-sm"
            />
            <span className="text-xs text-muted-foreground">CSV or Excel, up to {maxMb} MB. The file is uploaded as-is and read in pieces.</span>
          </label>

          {upload.isPending && <LoadingPlaceholder />}

          {current && fields.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-border pt-3">
              <p className="text-sm">
                <span className="font-medium">{current.fileName}</span>
                <span className="text-muted-foreground"> — {current.totalRows.toLocaleString()} rows</span>
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="pb-2 pr-3">Field</th>
                      <th className="pb-2">Column in your file</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((field) => (
                      <tr key={field.key} className="border-t border-border">
                        <td className="py-1.5 pr-3">
                          {field.label}
                          {field.required ? " *" : ""}
                          {field.help && <span className="mt-0.5 block text-xs text-muted-foreground">{field.help}</span>}
                        </td>
                        <td className="py-1.5">
                          <select
                            className="w-full max-w-xs rounded-md border border-border bg-background px-2 py-1 text-sm"
                            value={mapping[field.key] ?? ""}
                            onChange={(e) => {
                              setMapping({ ...mapping, [field.key]: e.target.value === "" ? null : Number(e.target.value) });
                              setChecked(false);
                            }}
                          >
                            <option value="">{field.required ? "Choose a column" : "Don't import"}</option>
                            {(current.headers ?? []).map((header, index) => (
                              <option key={`${header}-${index}`} value={index}>
                                {header}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {current.sample && current.sample.length > 0 && (
                <div className="overflow-x-auto text-xs text-muted-foreground">
                  <p className="mb-1 font-medium text-foreground">First rows</p>
                  <table className="w-full">
                    <tbody>
                      {current.sample.map((row, index) => (
                        <tr key={index} className="border-t border-border">
                          {row.slice(0, 8).map((cell, cellIndex) => (
                            <td key={cellIndex} className="max-w-[10rem] truncate py-1 pr-3">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {current.savedMappingApplied && <p className="text-sm text-muted-foreground">Saved column mapping for this import type was applied. Change a column if this file uses different headers.</p>}
              {!current.archiveOnly && (
              <SelectField label="Rows that already exist" value={duplicateMode} onChange={(e) => { setDuplicateMode(e.target.value); setChecked(false); }}>
                {DUPLICATE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectField>
              )}
              {!current.archiveOnly && (
              <SelectField label="Rows with problems" value={badRowMode} onChange={(e) => { setBadRowMode(e.target.value as "skip" | "fail"); setChecked(false); }}>
                <option value="skip">Skip bad rows and import the rest</option>
                <option value="fail">Import nothing if any row has a problem</option>
              </SelectField>
              )}
              {checked && (
                <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                  <p className="text-sm font-medium">Save as</p>
                  <TextField label="File name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
                  <p className="text-sm">
                    Folder: {folderId !== "" && folders.data ? folderPath(folders.data, folderId) || destination.data?.label || "Chosen folder" : (destination.data?.label ?? "Reports / Imported Data")}
                  </p>
                  <button type="button" className="w-fit text-sm text-primary hover:underline" onClick={() => setPickingFolder(true)}>
                    Choose a folder
                  </button>
                </div>
              )}
              {(selected?.supportsInvites || current.supportsInvites) && (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={sendInvites} onChange={(e) => setSendInvites(e.target.checked)} />
                  <span>
                    Email each new person a temporary password
                    <span className="block text-xs text-muted-foreground">Leave this off and nobody is emailed. You can set a temporary password for them later.</span>
                  </span>
                </label>
              )}

              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => check.mutate()} className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-60">
                  {check.isPending || current.status === "checking" ? "Checking…" : "Check file"}
                </button>
                <button type="button" disabled={busy || !checked || current.status === "completed" || !displayName.trim() || folderId === ""} onClick={() => run.mutate()} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
                  {run.isPending || current.status === "running" ? "Importing…" : "Import"}
                </button>
              </div>

              {(current.status === "running" || current.status === "checking") && (
                <div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {current.processedRows.toLocaleString()} of {current.totalRows.toLocaleString()} rows
                  </p>
                </div>
              )}

              {current.message && <p className="text-sm">{current.message}</p>}
              {current.problems.length > 0 && (
                <ul className="flex flex-col gap-1 text-sm">
                  {current.problems.slice(0, 20).map((problem) => (
                    <li key={`${problem.row}-${problem.label}`} className="text-destructive">
                      Row {problem.row} ({problem.label}): {problem.messages.join(" ")}
                    </li>
                  ))}
                </ul>
              )}
              {current.hasErrorReport && (
                <button type="button" className="w-fit text-sm text-primary hover:underline" onClick={() => saveFile(`/admin/imports/${current.id}/errors`, `import-${current.id}-errors.csv`)}>
                  Download the error report
                </button>
              )}
            </div>
          )}
          {pickingFolder && (
            <SaveAsFolderDialog
              folders={folders.data ?? []}
              selectedId={folderId}
              pending={false}
              onClose={() => setPickingFolder(false)}
              onSave={(id) => {
                setFolderId(id);
                setPickingFolder(false);
              }}
            />
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-medium">Past imports</h2>
          {history.isLoading ? (
            <LoadingPlaceholder />
          ) : (history.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing has been imported yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2">When</th>
                  <th className="pb-2">Who</th>
                  <th className="pb-2">File</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {(history.data ?? []).map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="py-1.5 pr-2 text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</td>
                    <td className="py-1.5 pr-2">{row.startedByName ?? "—"}</td>
                    <td className="py-1.5 pr-2">{row.fileName}</td>
                    <td className="py-1.5 pr-2">{typesQuery.data?.types.find((type) => type.key === row.entityKey)?.label ?? row.entityKey}</td>
                    <td className="py-1.5">
                      {row.message ?? row.status}
                      {row.hasErrorReport && (
                        <>
                          {" "}
                          <button type="button" className="text-primary hover:underline" onClick={() => saveFile(`/admin/imports/${row.id}/errors`, `import-${row.id}-errors.csv`)}>
                            Errors
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </ImportAccess>
    </div>
  );
}
