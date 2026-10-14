import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

export interface SourcePreview {
  fileName: string;
  sheets: { sheet: string; kind: string | null; label: string | null; rows: number; undated: number }[];
  kinds: { source: string; label: string; rows: number; months: { month: string; rows: number; added: number; updated: number; removed: number }[] }[];
  added: number;
  updated: number;
  removed: number;
  skippedVerified: { month: string; rows: number }[];
}

/** One line per recognized source: rows per month and what the import changes. */
export function previewLines(preview: SourcePreview): string[] {
  const lines = preview.kinds.map(
    (kind) => `${kind.label}: ${kind.months.map((month) => `${month.month} ${month.rows} (${month.added} new, ${month.updated} updated${month.removed ? `, ${month.removed} removed` : ""})`).join("; ")}`,
  );
  const ignored = preview.sheets.filter((sheet) => !sheet.kind).map((sheet) => sheet.sheet);
  if (ignored.length) lines.push(`Not recognized, ignored: ${ignored.join(", ")}`);
  const undated = preview.sheets.reduce((sum, sheet) => sum + sheet.undated, 0);
  if (undated) lines.push(`${undated} rows had no usable date and are left out.`);
  if (preview.skippedVerified.length) lines.push(`Skipped (month already verified): ${preview.skippedVerified.map((item) => `${item.month} ${item.rows}`).join(", ")}`);
  return lines;
}

/**
 * Upload DMA's monthly source spreadsheets. Rows file under their own months, whatever month is open.
 * The workbook is read and dropped; only the rows are kept until their month is verified.
 */
export function SourceImportPanel({ disabled }: { disabled: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const send = async (path: string, chosen: File) => {
    const body = new FormData();
    body.set("file", chosen);
    return (await apiClient.post<SourcePreview>(path, body, { headers: { "Content-Type": "multipart/form-data" } })).data;
  };
  const check = useMutation({
    mutationFn: (chosen: File) => send("/reports/engineering/sources/preview", chosen),
    onSuccess: setPreview,
    onError: (err) => toast.error(extractErrorMessage(err, "That file couldn't be read.")),
  });
  const commit = useMutation({
    mutationFn: (chosen: File) => send("/reports/engineering/sources", chosen),
    onSuccess: async (result) => {
      setPreview(null);
      setFile(null);
      await queryClient.invalidateQueries({ queryKey: ["engineering-report"] });
      toast.success(`Imported: ${result.added} new, ${result.updated} updated, ${result.removed} removed.`);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "The import didn't finish.")),
  });
  return (
    <div className="qe-no-print flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
      <p className="font-medium">Monthly source files</p>
      <p className="text-muted-foreground">NCR log, labor claim tracker or export, FAI trackers, tech-call log, product alerts (.xlsx). Each row is filed under the month of its own date.</p>
      <input
        type="file"
        accept=".xlsx"
        disabled={disabled || check.isPending || commit.isPending}
        onChange={(event) => {
          const chosen = event.target.files?.[0] ?? null;
          setFile(chosen);
          setPreview(null);
          if (chosen) check.mutate(chosen);
        }}
      />
      {check.isPending && <p className="text-muted-foreground">Reading…</p>}
      {preview && (
        <>
          <ul className="list-disc pl-5">
            {previewLines(preview).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button type="button" className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-60" disabled={disabled || commit.isPending || !file} onClick={() => file && commit.mutate(file)}>
              {commit.isPending ? "Importing…" : "Import"}
            </button>
            <button type="button" className="rounded-md border border-border px-3 py-1.5" onClick={() => setPreview(null)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export interface TechCallRow {
  contact: string;
  date: string;
  customerType: string;
  partNumber: string;
  partName: string;
  concern: string;
  resolution: string;
}

const TECH_CALL_COLUMNS: [keyof TechCallRow, string][] = [
  ["contact", "DMA Initial Contact"],
  ["date", "Date"],
  ["customerType", "Type of customer"],
  ["partNumber", "Part Number"],
  ["partName", "Part Name"],
  ["concern", "Concern description/concern"],
  ["resolution", "Resolution"],
];

/** Section 6.9's table of the month's tech-support calls, with DMA's column headings. */
export function TechCallTable({ rows }: { rows: TechCallRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {TECH_CALL_COLUMNS.map(([key, label]) => (
              <th key={key} className="border border-border px-2 py-1 text-left font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.date}-${index}`}>
              {TECH_CALL_COLUMNS.map(([key]) => (
                <td key={key} className="border border-border px-2 py-1 align-top">
                  {row[key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
