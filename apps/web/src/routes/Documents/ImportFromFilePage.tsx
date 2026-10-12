import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { buildConfirmValues, buildMappingEntries, countEdited, rowStatus, type ReviewRow, type TargetField } from "./importFromFileReview";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

interface ExtractedBlock {
  kind: "heading" | "para" | "table";
  text?: string;
  rows?: string[][];
}

interface ExtractedFile {
  fileName: string;
  kind: "docx" | "xlsx" | "csv";
  title: string | null;
  blocks: ExtractedBlock[];
  sheets: { name: string; cells: Record<string, string>; named: Record<string, string> }[];
  images: number;
}

interface ImportTarget {
  ref: string;
  title: string;
  formNumber: string | null;
  revision: string;
}

interface Proposal {
  key: string;
  label: string;
  value: string | string[][] | null;
  source: string | null;
  score: number;
  reason: string;
  rule: "label" | "heading" | "tableRow" | "tableField" | "named" | null;
}

interface SavedMapping {
  id: number;
  targetRef: string;
  fileKind: string;
  name: string;
}

function detectTitleMonthYear(title: string | null): { month: number; year: number } | null {
  if (!title) return null;
  for (let index = 0; index < MONTH_NAMES.length; index += 1) {
    const match = new RegExp(`${MONTH_NAMES[index]}\\D+(\\d{4})`, "i").exec(title);
    if (match) return { month: index + 1, year: Number(match[1]) };
  }
  return null;
}

export function ImportFromFilePage() {
  const toast = useToast();
  const navigate = useNavigate();

  const [file, setFile] = useState<File | null>(null);
  const [extracted, setExtracted] = useState<ExtractedFile | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [targetRef, setTargetRef] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [recordNumber, setRecordNumber] = useState("");
  const [title, setTitle] = useState("");
  const [reportMonth, setReportMonth] = useState<number | null>(null);
  const [reportYear, setReportYear] = useState<number | null>(null);
  const [replaceNotes, setReplaceNotes] = useState(false);
  const [saveMappingChecked, setSaveMappingChecked] = useState(false);
  const [mappingName, setMappingName] = useState("");

  const step = !extracted ? 0 : !targetRef ? 1 : 2;
  const isReportTarget = targetRef === "report:monthly-quality";
  const detected = detectTitleMonthYear(extracted?.title ?? null);

  const targets = useQuery<{ targets: ImportTarget[] }>({
    queryKey: ["form-import", "targets"],
    queryFn: async () => (await apiClient.get("/form-import/targets")).data,
  });

  const mappings = useQuery<{ mappings: SavedMapping[] }>({
    queryKey: ["form-import", "mappings", targetRef],
    queryFn: async () => (await apiClient.get("/form-import/mappings", { params: { targetRef } })).data,
    enabled: Boolean(targetRef),
  });

  const extract = useMutation({
    mutationFn: async (chosen: File) => {
      const body = new FormData();
      body.append("file", chosen);
      return (await apiClient.post<{ extracted: ExtractedFile; warnings: string[] }>("/form-import/extract", body)).data;
    },
    onSuccess: (data) => {
      setExtracted(data.extracted);
      setWarnings(data.warnings);
      setTitle(data.extracted.title ?? data.extracted.fileName);
      const found = detectTitleMonthYear(data.extracted.title);
      if (found) {
        setReportMonth(found.month);
        setReportYear(found.year);
      }
    },
    onError: (err) => toast.error(extractErrorMessage(err, "That file couldn't be read.")),
  });

  const propose = useMutation({
    mutationFn: async (ref: string) =>
      (await apiClient.post<{ fields: TargetField[]; proposals: Proposal[]; warnings: string[] }>("/form-import/propose", { targetRef: ref, extracted })).data,
    onSuccess: (data) => {
      setWarnings((current) => [...current, ...(data.warnings ?? [])]);
      setRows(
        data.fields.map((field) => {
          const proposal = data.proposals.find((item) => item.key === field.key) ?? null;
          const value = proposal?.value ?? null;
          return { field, original: value, value, source: proposal?.source ?? null, reason: proposal?.reason ?? "no match", rule: proposal?.rule ?? null };
        }),
      );
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't match that file to this form.")),
  });

  const save = useMutation({
    mutationFn: async () => {
      const edited = countEdited(rows);
      const values = buildConfirmValues(rows);
      if (saveMappingChecked && extracted && mappingName.trim()) {
        await apiClient.post("/form-import/mappings", {
          targetRef,
          fileKind: extracted.kind,
          name: mappingName.trim(),
          entries: buildMappingEntries(rows),
        });
      }
      return (
        await apiClient.post<{ openPath: string }>("/form-import/confirm", {
          targetRef,
          fileName: extracted?.fileName ?? file?.name ?? "upload",
          title: title || undefined,
          recordNumber: recordNumber || null,
          edited,
          values,
          ...(isReportTarget ? { year: reportYear, month: reportMonth, replaceNotes } : {}),
        })
      ).data;
    },
    onSuccess: (data) => {
      toast.success("Filled copy saved.");
      navigate(data.openPath);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "That import couldn't be saved.")),
  });

  const filteredTargets = useMemo(() => {
    const list = targets.data?.targets ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((target) => target.title.toLowerCase().includes(needle) || (target.formNumber ?? "").toLowerCase().includes(needle));
  }, [targets.data, search]);

  const groups = useMemo(() => {
    const order: string[] = [];
    for (const row of rows) if (!order.includes(row.field.group)) order.push(row.field.group);
    return order;
  }, [rows]);

  const renameMapping = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => (await apiClient.patch(`/form-import/mappings/${id}`, { name })).data,
    onSuccess: () => mappings.refetch(),
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't rename that mapping.")),
  });

  const removeMapping = useMutation({
    mutationFn: async (id: number) => apiClient.delete(`/form-import/mappings/${id}`),
    onSuccess: () => mappings.refetch(),
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't delete that mapping.")),
  });

  function reset() {
    setFile(null);
    setExtracted(null);
    setWarnings([]);
    setTargetRef(null);
    setRows([]);
    setRecordNumber("");
    setTitle("");
    setReportMonth(null);
    setReportYear(null);
    setReplaceNotes(false);
    setSaveMappingChecked(false);
    setMappingName("");
  }

  function updateScalar(key: string, next: string) {
    setRows((current) => current.map((row) => (row.field.key === key ? { ...row, value: next } : row)));
  }

  function updateTableCell(key: string, rowIndex: number, colIndex: number, next: string) {
    setRows((current) =>
      current.map((row) => {
        if (row.field.key !== key) return row;
        const table = Array.isArray(row.value) ? row.value.map((line) => [...line]) : [];
        if (!table[rowIndex]) table[rowIndex] = row.field.columns?.map(() => "") ?? [];
        table[rowIndex]![colIndex] = next;
        return { ...row, value: table };
      }),
    );
  }

  function clearRow(key: string) {
    setRows((current) => current.map((row) => (row.field.key === key ? { ...row, value: null } : row)));
  }

  function acceptRow(key: string) {
    setRows((current) => current.map((row) => (row.field.key === key ? { ...row, value: row.original } : row)));
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Import from file</h1>
        <p className="text-sm text-muted-foreground">Upload a Word, Excel, or CSV file, match it to a form, then review the proposed values before saving.</p>
      </div>

      {step === 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">.docx, .xlsx, .xls, or .csv. Up to 8 MB.</p>
          <input
            type="file"
            accept=".docx,.xlsx,.xls,.csv"
            aria-label="Choose a file"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              if (chosen) {
                setFile(chosen);
                extract.mutate(chosen);
              }
            }}
          />
          {extract.isPending && <LoadingPlaceholder />}
        </div>
      )}

      {step === 1 && extracted && (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-border bg-card p-4 text-sm">
            <div className="font-medium">{extracted.fileName}</div>
            {extracted.images > 0 && <p className="mt-1 text-muted-foreground">{extracted.images} image(s) are not imported.</p>}
            {warnings.map((note) => (
              <p key={note} className="mt-1 text-muted-foreground">
                {note}
              </p>
            ))}
          </div>
          <input
            type="search"
            placeholder="Search forms…"
            aria-label="Search forms"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="rounded-md border border-form-field bg-[hsl(var(--form-input))] px-3 py-2 text-sm"
          />
          {targets.isLoading && <LoadingPlaceholder />}
          <div className="grid gap-2 md:grid-cols-2">
            {filteredTargets.map((target) => (
              <button
                key={target.ref}
                type="button"
                className="rounded-lg border border-border bg-card p-3 text-left text-sm hover:bg-muted"
                onClick={() => {
                  setTargetRef(target.ref);
                  propose.mutate(target.ref);
                }}
              >
                <div className="font-medium">{target.title}</div>
                {target.formNumber && <div className="text-xs text-muted-foreground">{target.formNumber}</div>}
              </button>
            ))}
          </div>
          <button type="button" className="w-fit text-sm text-primary hover:underline" onClick={reset}>
            Choose a different file
          </button>
        </div>
      )}

      {step === 2 && extracted && (
        <div className="flex flex-col gap-3">
          {propose.isPending && <LoadingPlaceholder />}

          {isReportTarget ? (
            <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
              <label className="flex flex-col text-sm">
                Month
                <select
                  className="rounded-md border border-form-field bg-[hsl(var(--form-input))] px-2 py-1.5"
                  value={reportMonth ?? ""}
                  onChange={(event) => setReportMonth(event.target.value ? Number(event.target.value) : null)}
                >
                  <option value="">Choose a month</option>
                  {MONTH_NAMES.map((name, index) => (
                    <option key={name} value={index + 1}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col text-sm">
                Year
                <input
                  type="number"
                  className="w-24 rounded-md border border-form-field bg-[hsl(var(--form-input))] px-2 py-1.5"
                  value={reportYear ?? ""}
                  onChange={(event) => setReportYear(event.target.value ? Number(event.target.value) : null)}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={replaceNotes} onChange={(event) => setReplaceNotes(event.target.checked)} />
                Replace narrative already typed
              </label>
              {detected && (detected.month !== reportMonth || detected.year !== reportYear) && (
                <p className="w-full text-sm text-destructive">
                  The file's title says {MONTH_NAMES[detected.month - 1]} {detected.year}, but {reportMonth ? MONTH_NAMES[reportMonth - 1] : "no month"}{" "}
                  {reportYear ?? ""} is selected. Double-check before saving.
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex flex-col text-sm">
                Title
                <input className="rounded-md border border-form-field bg-[hsl(var(--form-input))] px-2 py-1.5" value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label className="flex flex-col text-sm">
                Record number
                <input
                  className="rounded-md border border-form-field bg-[hsl(var(--form-input))] px-2 py-1.5"
                  placeholder="Blank is fine"
                  value={recordNumber}
                  onChange={(event) => setRecordNumber(event.target.value)}
                />
              </label>
            </div>
          )}

          {(mappings.data?.mappings.length ?? 0) > 0 && (
            <section className="rounded-lg border border-border bg-card p-3 text-sm">
              <h3 className="font-semibold">Mappings</h3>
              <ul className="mt-1 flex flex-col gap-1">
                {mappings.data!.mappings.map((item) => (
                  <li key={item.id} className="flex items-center gap-2">
                    <span className="flex-1">{item.name}</span>
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => {
                        const next = window.prompt("Rename mapping", item.name);
                        if (next && next.trim()) renameMapping.mutate({ id: item.id, name: next.trim() });
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="text-destructive hover:underline"
                      onClick={() => {
                        if (window.confirm(`Delete mapping "${item.name}"?`)) removeMapping.mutate(item.id);
                      }}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {groups.map((group) => (
            <section key={group} className="rounded-lg border border-border bg-card">
              <h3 className="border-b border-border px-4 py-2 text-sm font-semibold">{group}</h3>
              <div className="divide-y divide-border">
                {rows
                  .filter((row) => row.field.group === group)
                  .map((row) => {
                    const status = rowStatus(row);
                    return (
                      <div key={row.field.key} className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(0,0.6fr)]">
                        <div>
                          <div className="text-sm font-medium">{row.field.label}</div>
                          {row.source && <div className="text-xs text-muted-foreground">Source: {row.source}</div>}
                        </div>
                        {row.field.type === "table" ? (
                          <div className="overflow-x-auto">
                            <table className="text-sm">
                              <thead>
                                <tr>
                                  {(row.field.columns ?? []).map((column) => (
                                    <th key={column.id} className="px-1 text-left font-medium">
                                      {column.label}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {(Array.isArray(row.value) ? row.value : []).map((line, rowIndex) => (
                                  <tr key={rowIndex}>
                                    {line.map((cell, colIndex) => (
                                      <td key={colIndex} className="px-1 py-0.5">
                                        <input
                                          aria-label={`${row.field.label} row ${rowIndex + 1} ${row.field.columns?.[colIndex]?.label ?? ""}`}
                                          className="w-24 rounded border border-form-field bg-[hsl(var(--form-input))] px-1 py-0.5"
                                          value={cell}
                                          onChange={(event) => updateTableCell(row.field.key, rowIndex, colIndex, event.target.value)}
                                        />
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : row.field.type === "multiline" ? (
                          <textarea
                            aria-label={row.field.label}
                            className="min-h-[4rem] rounded-md border border-form-field bg-[hsl(var(--form-input))] px-2 py-1.5 text-sm"
                            value={typeof row.value === "string" ? row.value : ""}
                            onChange={(event) => updateScalar(row.field.key, event.target.value)}
                          />
                        ) : (
                          <input
                            aria-label={row.field.label}
                            className="rounded-md border border-form-field bg-[hsl(var(--form-input))] px-2 py-1.5 text-sm"
                            value={typeof row.value === "string" ? row.value : ""}
                            onChange={(event) => updateScalar(row.field.key, event.target.value)}
                          />
                        )}
                        <div className="flex flex-col gap-1 text-xs">
                          <span
                            className={
                              status === "Matched" ? "text-emerald-600" : status === "Edited" ? "text-amber-600" : "text-muted-foreground"
                            }
                          >
                            {status}
                          </span>
                          {row.reason && row.reason !== "no match" && (
                            <span className="w-fit rounded-full border border-border px-2 py-0.5 text-muted-foreground">{row.reason}</span>
                          )}
                          <div className="flex gap-2">
                            <button type="button" className="text-primary hover:underline" onClick={() => acceptRow(row.field.key)}>
                              Accept
                            </button>
                            <button type="button" className="text-muted-foreground hover:underline" onClick={() => clearRow(row.field.key)}>
                              Clear
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </section>
          ))}

          <label className="flex flex-wrap items-center gap-2 text-sm">
            <input type="checkbox" checked={saveMappingChecked} onChange={(event) => setSaveMappingChecked(event.target.checked)} />
            Save mapping for next time
            {saveMappingChecked && (
              <input
                className="rounded-md border border-form-field bg-[hsl(var(--form-input))] px-2 py-1.5"
                placeholder="Mapping name"
                value={mappingName}
                onChange={(event) => setMappingName(event.target.value)}
              />
            )}
          </label>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted" onClick={reset}>
              Cancel
            </button>
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-60"
              disabled={save.isPending || rows.length === 0 || (saveMappingChecked && !mappingName.trim())}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : "Save filled copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
