import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, UploadCloud } from "lucide-react";
import { apiClient } from "../../api/client";
import { Modal } from "../modals/Modal";
import { FileDropZone } from "../shared/FileDropZone";
import { useToast } from "../shared/ToastProvider";
import { extractErrorMessageAsync } from "../../hooks/useWorkflowAction";

export type ImportEntityKey = "suppliers" | "inventory_items" | "people";

interface ImportField {
  key: string;
  label: string;
  required?: boolean;
  help?: string;
}
interface EntityInfo {
  key: ImportEntityKey;
  label: string;
  description: string;
  fields: ImportField[];
}
interface Preview {
  headers: string[];
  sample: string[][];
  totalRows: number;
  mapping: Record<string, number | null>;
}
interface Problem {
  row: number;
  label: string;
  messages: string[];
}
interface RunResult {
  total: number;
  valid: number;
  invalid: number;
  created: number;
  problems: Problem[];
  problemsTruncated: boolean;
  credentials: { row: number; email: string; temporaryPassword: string }[];
}

type Step = "upload" | "map" | "review" | "done";
const ACCEPT = ".xlsx,.csv";

function columnLetter(index: number): string {
  let n = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

function downloadBlob(data: BlobPart, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** Import a list from Excel or CSV: choose a file, match its columns, check every row, then import. Nothing is saved until the last step. */
export function ImportDialog({ entity, isOpen, onClose }: { entity: ImportEntityKey; isOpen: boolean; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [report, setReport] = useState<RunResult | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: info } = useQuery<EntityInfo>({
    queryKey: ["import", entity],
    queryFn: async () => (await apiClient.get(`/import/${entity}`)).data,
    enabled: isOpen,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!isOpen) return;
    setStep("upload");
    setFile(null);
    setPreview(null);
    setMapping({});
    setReport(null);
    setResult(null);
    setBusy(false);
  }, [isOpen, entity]);

  async function post<T>(path: string, chosen: File, extra: Record<string, string> = {}): Promise<T> {
    const form = new FormData();
    form.append("file", chosen);
    for (const [k, v] of Object.entries(extra)) form.append(k, v);
    return (await apiClient.post(`/import/${entity}/${path}`, form, { headers: { "Content-Type": "multipart/form-data" } })).data as T;
  }

  async function choose(chosen: File) {
    setBusy(true);
    try {
      const data = await post<Preview>("preview", chosen);
      setFile(chosen);
      setPreview(data);
      setMapping(data.mapping);
      setStep("map");
    } catch (err) {
      toast.error(await extractErrorMessageAsync(err, "Couldn't read that file."));
    } finally {
      setBusy(false);
    }
  }

  async function run(mode: "validate" | "import") {
    if (!file) return;
    setBusy(true);
    try {
      const data = await post<RunResult>("run", file, { mapping: JSON.stringify(mapping), mode });
      if (mode === "validate") {
        setReport(data);
        setStep("review");
      } else {
        setResult(data);
        setStep("done");
        void qc.invalidateQueries();
      }
    } catch (err) {
      toast.error(await extractErrorMessageAsync(err, mode === "import" ? "The import didn't finish." : "Couldn't check the file."));
    } finally {
      setBusy(false);
    }
  }

  async function downloadTemplate() {
    try {
      const res = await apiClient.get(`/import/${entity}/template`, { responseType: "blob" });
      downloadBlob(res.data as Blob, `${entity}-import-template.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } catch (err) {
      toast.error(await extractErrorMessageAsync(err, "Couldn't download the template."));
    }
  }

  const fields = info?.fields ?? [];
  const missingRequired = fields.filter((f) => f.required && (mapping[f.key] === null || mapping[f.key] === undefined));
  const stepIndex = ["upload", "map", "review", "done"].indexOf(step);

  return (
    <Modal title={`Import ${info?.label ?? "list"} from Excel`} isOpen={isOpen} onClose={onClose} wide>
      <ol className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
        {["Choose file", "Match columns", "Check", "Done"].map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden className={`h-0.5 w-6 rounded-full ${i <= stepIndex ? "bg-primary" : "bg-border"}`} />}
            <span className={i === stepIndex ? "font-semibold text-foreground" : i < stepIndex ? "text-foreground/80" : ""}>{label}</span>
          </li>
        ))}
      </ol>

      {step === "upload" && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{info?.description}</p>
          <FileDropZone onFiles={(files) => void choose(files[0]!)} accept={ACCEPT} multiple={false} disabled={busy} overlay={false} className="rounded-xl border-2 border-dashed border-border p-8 text-center transition-colors hover:border-primary/60">
            <div className="flex flex-col items-center gap-2">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
                <UploadCloud size={22} />
              </span>
              <p className="text-sm font-medium">{busy ? "Reading your file…" : "Drag your Excel or CSV file here"}</p>
              <button type="button" onClick={() => input.current?.click()} disabled={busy} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60">
                Choose a file…
              </button>
              <input
                ref={input}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const chosen = e.target.files?.[0];
                  if (chosen) void choose(chosen);
                  e.target.value = "";
                }}
              />
              <p className="text-xs text-muted-foreground">The first sheet is used. The first row must be the column headings. Up to 5,000 rows.</p>
            </div>
          </FileDropZone>
          <div className="rounded-lg bg-muted/50 p-3 text-sm">
            <p className="mb-1 font-medium">Columns this list understands</p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {fields.map((f) => (
                <li key={f.key}>
                  {f.label}
                  {f.required ? <span className="text-destructive"> *</span> : ""}
                </li>
              ))}
            </ul>
          </div>
          <button type="button" onClick={downloadTemplate} className="flex w-fit items-center gap-2 text-sm text-primary hover:underline">
            <Download size={14} /> Download a ready-made Excel template
          </button>
        </div>
      )}

      {step === "map" && preview && (
        <div className="flex flex-col gap-4">
          <p className="flex items-center gap-2 text-sm">
            <FileSpreadsheet size={16} className="text-primary" />
            <span className="font-medium">{file?.name}</span>
            <span className="text-muted-foreground">· {preview.totalRows} rows</span>
          </p>
          <p className="text-sm text-muted-foreground">We matched your columns where we could. Check each one, and choose the right column for anything that's wrong or missing.</p>
          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
            {fields.map((f) => {
              const column = mapping[f.key];
              const samples = column === null || column === undefined ? [] : preview.sample.map((row) => row[column]).filter(Boolean).slice(0, 3);
              return (
                <div key={f.key} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1.2fr]">
                  <div>
                    <p className="text-sm font-medium">
                      {f.label}
                      {f.required && <span className="text-destructive"> *</span>}
                    </p>
                    {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
                  </div>
                  <div className="min-w-0">
                    <select
                      aria-label={`Column for ${f.label}`}
                      value={column ?? ""}
                      onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value === "" ? null : Number(e.target.value) })}
                      className="w-full rounded-md border border-form-field bg-background px-2 py-1.5 text-sm"
                    >
                      <option value="">{f.required ? "Choose a column…" : "Skip — leave blank"}</option>
                      {preview.headers.map((h, i) => (
                        <option key={i} value={i}>
                          {columnLetter(i)} — {h}
                        </option>
                      ))}
                    </select>
                    {samples.length > 0 && <p className="mt-1 truncate text-xs text-muted-foreground">e.g. {samples.join(", ")}</p>}
                  </div>
                </div>
              );
            })}
          </div>
          {missingRequired.length > 0 && <p className="text-xs text-destructive">Still needed: {missingRequired.map((f) => f.label).join(", ")}.</p>}
          <div className="flex justify-between gap-2">
            <button type="button" onClick={() => setStep("upload")} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              Back
            </button>
            <button type="button" disabled={busy || missingRequired.length > 0} onClick={() => void run("validate")} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {busy ? "Checking…" : "Check my file"}
            </button>
          </div>
        </div>
      )}

      {step === "review" && report && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat label="Rows in file" value={report.total} />
            <Stat label="Ready to import" value={report.valid} tone="success" />
            <Stat label="Need attention" value={report.invalid} tone={report.invalid > 0 ? "warning" : undefined} />
          </div>
          {report.invalid > 0 ? (
            <ProblemList problems={report.problems} truncated={report.problemsTruncated} note="Rows with problems are skipped. Fix them in your file and import that file again. Rows already imported are recognized and skipped." />
          ) : (
            <p className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 size={16} /> Every row looks good.
            </p>
          )}
          <div className="flex justify-between gap-2">
            <button type="button" onClick={() => setStep("map")} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              Back
            </button>
            <button type="button" disabled={busy || report.valid === 0} onClick={() => void run("import")} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {busy ? "Importing…" : `Import ${report.valid} ${report.valid === 1 ? "row" : "rows"}`}
            </button>
          </div>
        </div>
      )}

      {step === "done" && result && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-lg border border-success/40 bg-success/10 p-4">
            <CheckCircle2 size={22} className="text-success" />
            <div>
              <p className="font-medium">
                Imported {result.created} {result.created === 1 ? "row" : "rows"}
              </p>
              {result.invalid > 0 && <p className="text-sm text-muted-foreground">{result.invalid} skipped — see below.</p>}
            </div>
          </div>
          {result.credentials.length > 0 && (
            <div className="rounded-lg border border-warning/50 bg-warning/10 p-3">
              <p className="mb-1 flex items-center gap-2 text-sm font-medium">
                <AlertTriangle size={15} /> Temporary passwords — shown only now
              </p>
              <p className="mb-2 text-xs text-muted-foreground">Save this list and give each person their password privately. They can change it after signing in. It can't be shown again.</p>
              <div className="max-h-40 overflow-y-auto rounded-md bg-background/60">
                <table className="w-full text-xs">
                  <tbody>
                    {result.credentials.map((c) => (
                      <tr key={c.email} className="border-b border-border/60 last:border-0">
                        <td className="px-2 py-1">{c.email}</td>
                        <td className="px-2 py-1 font-mono">{c.temporaryPassword}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onClick={() => downloadBlob(`email,temporary password\n${result.credentials.map((c) => `${c.email},${c.temporaryPassword}`).join("\n")}\n`, "temporary-passwords.csv", "text/csv")}
                className="mt-2 flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
              >
                <Download size={13} /> Download as CSV
              </button>
            </div>
          )}
          {result.invalid > 0 && <ProblemList problems={result.problems} truncated={result.problemsTruncated} />}
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "success" | "warning" }) {
  const color = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-lg border border-border p-3">
      <p className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function ProblemList({ problems, truncated, note }: { problems: Problem[]; truncated: boolean; note?: string }) {
  return (
    <div>
      {note && <p className="mb-2 text-xs text-muted-foreground">{note}</p>}
      <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-2 text-sm">
        {problems.map((p) => (
          <li key={p.row} className="rounded-md px-2 py-1 hover:bg-muted/50">
            <span className="font-medium">Row {p.row}</span> <span className="text-muted-foreground">· {p.label}</span>
            <ul className="text-xs text-destructive">
              {p.messages.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {truncated && <p className="mt-1 text-xs text-muted-foreground">Showing the first {problems.length} problems.</p>}
    </div>
  );
}

/** The header button that opens the import dialog. */
export function ImportButton({ entity, className = "" }: { entity: ImportEntityKey; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted ${className}`}>
        <FileSpreadsheet size={15} /> Import from Excel
      </button>
      <ImportDialog entity={entity} isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}
