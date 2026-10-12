import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { buildConfirmValues, countEdited, rowStatus, type ReviewRow, type TargetField } from "./importFromFileReview";

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

  const step = !extracted ? 0 : !targetRef ? 1 : 2;

  const targets = useQuery<{ targets: ImportTarget[] }>({
    queryKey: ["form-import", "targets"],
    queryFn: async () => (await apiClient.get("/form-import/targets")).data,
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
    },
    onError: (err) => toast.error(extractErrorMessage(err, "That file couldn't be read.")),
  });

  const propose = useMutation({
    mutationFn: async (ref: string) => (await apiClient.post<{ fields: TargetField[]; proposals: Proposal[] }>("/form-import/propose", { targetRef: ref, extracted })).data,
    onSuccess: (data) => {
      setRows(
        data.fields.map((field) => {
          const proposal = data.proposals.find((item) => item.key === field.key) ?? null;
          const value = proposal?.value ?? null;
          return { field, original: value, value, source: proposal?.source ?? null };
        }),
      );
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't match that file to this form.")),
  });

  const save = useMutation({
    mutationFn: async () => {
      const edited = countEdited(rows);
      const values = buildConfirmValues(rows);
      return (
        await apiClient.post<{ openPath: string }>("/form-import/confirm", {
          targetRef,
          fileName: extracted?.fileName ?? file?.name ?? "upload",
          title: title || undefined,
          recordNumber: recordNumber || null,
          edited,
          values,
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

  function reset() {
    setFile(null);
    setExtracted(null);
    setWarnings([]);
    setTargetRef(null);
    setRows([]);
    setRecordNumber("");
    setTitle("");
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

          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted" onClick={reset}>
              Cancel
            </button>
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-60"
              disabled={save.isPending || rows.length === 0}
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
