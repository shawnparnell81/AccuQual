import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";

interface ImportField {
  key: string;
  label: string;
  group: string;
  required: boolean;
  valueType: string;
  identity: string | null;
}

interface ImportTemplate {
  key: string;
  title: string;
  printedId: string;
  formId: string;
  displayNumber: string;
  templateId: number | null;
  subjectRoute: string;
  listPath: string;
  shape: "table" | "sheet";
  fields: ImportField[];
}

interface SourceColumn {
  index: number;
  header: string;
  samples: string[];
}

interface MappingEntry {
  fieldKey: string;
  columnIndex: number | null;
  confidence: number;
  reason: string;
}

interface InspectedFile {
  templateKey: string;
  fileName: string;
  mode: "rows" | "record";
  notes: string[];
  truncated: boolean;
  columns: SourceColumn[];
  records: { rowNumber: number; cells: string[] }[];
  mapping: MappingEntry[];
}

interface PlannedValue {
  key: string;
  label: string;
  value: string;
}

interface PlannedRow {
  rowNumber: number;
  action: "create" | "update" | "skip";
  summary: string;
  issues: string[];
  notes: string[];
  values: PlannedValue[];
}

interface PreviewResult {
  ready: number;
  skipped: number;
  rows: PlannedRow[];
}

interface WrittenRecord {
  id: number;
  href: string;
  label: string;
}

interface ExecuteResult {
  listPath: string;
  created: WrittenRecord[];
  updated: WrittenRecord[];
  skipped: { rowNumber: number; summary: string }[];
}

const STEPS = ["Template", "Upload", "Map columns", "Preview & import"] as const;

function confidenceLabel(confidence: number, reason: string): string {
  if (!reason) return "Not matched";
  return `${Math.round(confidence * 100)}% · ${reason}`;
}

export function FormImportPage() {
  const toast = useToast();
  const templates = useQuery<{ accept: string; templates: ImportTemplate[] }>({
    queryKey: ["form-import", "templates"],
    queryFn: async () => (await apiClient.get("/form-import/templates")).data,
  });

  const [step, setStep] = useState(0);
  const [templateKey, setTemplateKey] = useState("");
  const [inspected, setInspected] = useState<InspectedFile | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [reasons, setReasons] = useState<Record<string, { confidence: number; reason: string }>>({});
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [mappedOnly, setMappedOnly] = useState(false);

  const selected = templates.data?.templates.find((template) => template.key === templateKey) ?? null;

  const groups = useMemo(() => {
    const order: string[] = [];
    for (const field of selected?.fields ?? []) {
      if (!order.includes(field.group)) order.push(field.group);
    }
    return order;
  }, [selected]);

  function applyInspection(data: InspectedFile) {
    const next: Record<string, number | null> = {};
    const why: Record<string, { confidence: number; reason: string }> = {};
    for (const entry of data.mapping) {
      next[entry.fieldKey] = entry.columnIndex;
      why[entry.fieldKey] = { confidence: entry.confidence, reason: entry.reason };
    }
    setMapping(next);
    setReasons(why);
    setInspected(data);
    setPreview(null);
    setResult(null);
    setStep(2);
  }

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("templateKey", templateKey);
      body.append("file", file);
      return (await apiClient.post<InspectedFile>("/form-import/inspect", body)).data;
    },
    onSuccess: (data) => {
      applyInspection(data);
      toast.success("File read. Confirm the column matches before importing.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "That file couldn't be read.")),
  });

  function payload() {
    return { templateKey, columns: inspected?.columns ?? [], records: inspected?.records ?? [], mapping };
  }

  const check = useMutation({
    mutationFn: async () => (await apiClient.post<PreviewResult>("/form-import/preview", payload())).data,
    onSuccess: (data) => {
      setPreview(data);
      setResult(null);
      setStep(3);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't preview that import.")),
  });

  const run = useMutation({
    mutationFn: async () => (await apiClient.post<ExecuteResult>("/form-import/execute", payload())).data,
    onSuccess: (data) => {
      setResult(data);
      const count = data.created.length + data.updated.length;
      if (count === 0) toast.error("Nothing was imported. See the skipped rows.");
      else toast.success(`Imported ${count} record${count === 1 ? "" : "s"}.`);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "The import didn't finish.")),
  });

  function setColumn(fieldKey: string, raw: string) {
    const columnIndex = raw === "" ? null : Number(raw);
    setMapping((current) => ({ ...current, [fieldKey]: columnIndex }));
    setReasons((current) => ({
      ...current,
      [fieldKey]: columnIndex == null ? { confidence: 0, reason: "" } : { confidence: 1, reason: "You chose this column" },
    }));
    setPreview(null);
    setResult(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Import a filled form</h1>
        <p className="text-sm text-muted-foreground">
          Upload a CSV, Excel, or JSON file and match its columns to an AccuQual template. Form numbers already on the template are kept. New documents open as drafts.
        </p>
      </div>

      <ol className="flex flex-wrap gap-2 text-sm">
        {STEPS.map((label, index) => (
          <li key={label} className={`rounded-full border px-3 py-1 ${index === step ? "border-primary bg-primary/10 font-medium" : "border-border text-muted-foreground"}`}>
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {templates.isLoading && <LoadingPlaceholder />}
      {templates.isError && <p className="text-sm text-destructive">Couldn't load the form templates.</p>}

      {step === 0 && templates.data && (
        <div className="grid gap-3 md:grid-cols-2">
          {templates.data.templates.map((template) => (
            <button
              key={template.key}
              type="button"
              onClick={() => {
                setTemplateKey(template.key);
                setInspected(null);
                setPreview(null);
                setResult(null);
                setStep(1);
              }}
              className={`rounded-lg border p-4 text-left hover:bg-muted ${templateKey === template.key ? "border-primary" : "border-border bg-card"}`}
            >
              <div className="text-sm font-medium">{template.displayNumber}</div>
              <div className="mt-1 text-base font-semibold">{template.title}</div>
              <p className="mt-2 text-sm text-muted-foreground">
                Template id {template.templateId ?? "—"}. Stored number {template.formId || "blank"}. {template.shape === "sheet" ? "One filled sheet, or a table with one row per report." : "One row per document."}
              </p>
            </button>
          ))}
        </div>
      )}

      {step === 1 && selected && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <div>
            <h2 className="text-lg font-semibold">{selected.displayNumber} · {selected.title}</h2>
            <p className="text-sm text-muted-foreground">CSV, .xls, .xlsx, or JSON. Up to 8 MB. Word files are not imported.</p>
          </div>
          <input
            type="file"
            accept={templates.data?.accept ?? ".csv,.xls,.xlsx,.json"}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload.mutate(file);
            }}
            className="text-sm"
          />
          {upload.isPending && <p className="text-sm text-muted-foreground">Reading the file…</p>}
          <button type="button" className="w-fit text-sm text-primary hover:underline" onClick={() => setStep(0)}>Choose a different template</button>
        </div>
      )}

      {step >= 2 && inspected && selected && (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-border bg-card p-4 text-sm">
            <div className="font-medium">{inspected.fileName}</div>
            <ul className="mt-2 list-disc pl-5 text-muted-foreground">
              {inspected.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>

          {step === 2 && (
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={mappedOnly} onChange={(event) => setMappedOnly(event.target.checked)} />
                Show matched fields only
              </label>
              {groups.map((group) => {
                const fields = selected.fields.filter((field) => field.group === group && (!mappedOnly || mapping[field.key] != null));
                if (fields.length === 0) return null;
                return (
                  <section key={group} className="rounded-lg border border-border bg-card">
                    <h3 className="border-b border-border px-4 py-2 text-sm font-semibold">{group}</h3>
                    <div className="divide-y divide-border">
                      {fields.map((field) => {
                        const column = mapping[field.key];
                        const why = reasons[field.key];
                        const sample = column == null ? "" : inspected.columns.find((item) => item.index === column)?.samples.join(", ") ?? "";
                        return (
                          <div key={field.key} className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.8fr)] md:items-center">
                            <div>
                              <div className="text-sm font-medium">
                                {field.label}
                                {field.required ? " *" : ""}
                              </div>
                              <div className="text-xs text-muted-foreground">{field.key}{field.identity ? " · used only to find an existing draft" : ""}</div>
                            </div>
                            <select
                              aria-label={`Column for ${field.label}`}
                              className="rounded-md border border-form-field bg-[hsl(var(--form-input))] px-2 py-1.5 text-sm"
                              value={column == null ? "" : String(column)}
                              onChange={(event) => setColumn(field.key, event.target.value)}
                            >
                              <option value="">Don't import</option>
                              {inspected.columns.map((item) => (
                                <option key={item.index} value={item.index}>{item.header}</option>
                              ))}
                            </select>
                            <div className="text-xs text-muted-foreground">
                              <div>{confidenceLabel(why?.confidence ?? 0, why?.reason ?? "")}</div>
                              {sample ? <div className="mt-1">Sample: {sample}</div> : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted" onClick={() => setStep(1)}>Back</button>
                <button type="button" className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-60" disabled={check.isPending} onClick={() => check.mutate()}>
                  {check.isPending ? "Checking…" : "Preview import"}
                </button>
              </div>
            </div>
          )}

          {step === 3 && preview && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{preview.ready} ready · {preview.skipped} skipped. Import does not publish a document or change a form number.</p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="px-3 py-2">Row</th>
                      <th className="px-3 py-2">Action</th>
                      <th className="px-3 py-2">What will be saved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={row.rowNumber} className="border-t border-border align-top">
                        <td className="px-3 py-2">{row.rowNumber}</td>
                        <td className="px-3 py-2">{row.action}</td>
                        <td className="px-3 py-2">
                          <div>{row.summary}</div>
                          {row.issues.map((issue) => (
                            <div key={issue} className="text-destructive">{issue}</div>
                          ))}
                          {row.notes.map((note) => (
                            <div key={note} className="text-muted-foreground">{note}</div>
                          ))}
                          {row.values.length > 0 && (
                            <div className="mt-1 text-muted-foreground">{row.values.map((value) => `${value.label}: ${value.value}`).join(" · ")}</div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted" onClick={() => setStep(2)}>Back to mapping</button>
                <button type="button" className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-60" disabled={run.isPending || preview.ready === 0} onClick={() => run.mutate()}>
                  {run.isPending ? "Importing…" : "Import"}
                </button>
              </div>
              {result && (
                <div className="rounded-lg border border-border bg-card p-4 text-sm">
                  <h3 className="font-semibold">Imported</h3>
                  <ul className="mt-2 space-y-1">
                    {[...result.created, ...result.updated].map((record) => (
                      <li key={record.href}>
                        <Link to={record.href} className="text-primary hover:underline">{record.label}</Link>
                      </li>
                    ))}
                  </ul>
                  {result.skipped.length > 0 && (
                    <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                      {result.skipped.map((row) => (
                        <li key={`${row.rowNumber}-${row.summary}`}>Row {row.rowNumber}: {row.summary}</li>
                      ))}
                    </ul>
                  )}
                  <Link to={result.listPath} className="mt-3 inline-block text-primary hover:underline">Open the list</Link>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
