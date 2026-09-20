import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { AdminOnlyGuard } from "../../components/shared/AdminOnlyGuard";
import { TextField, SelectField } from "../../components/forms/Field";

interface Contents {
  tables: { table: string; rows: number; omittedColumns: string[] }[];
  excluded: { table: string; reason: string }[];
  totalRows: number;
}

/**
 * Admin Console → Data Export. Everything the organization keeps in AccuQual, as a ZIP. The administrator re-confirms
 * their password first (this hands over everything), and the download starts from a short-lived single-use link.
 */
export function AdminDataExportPage() {
  const toast = useToast();
  const { data: contents } = useQuery<Contents>({ queryKey: ["data-export/contents"], queryFn: async () => (await apiClient.get("/data-export/contents")).data });
  const [format, setFormat] = useState<"json" | "csv">("json");
  const [includeFiles, setIncludeFiles] = useState(true);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [showTables, setShowTables] = useState(false);
  const [started, setStarted] = useState(false);

  const request = useMutation({
    mutationFn: async () => (await apiClient.post<{ downloadUrl: string; expiresInSeconds: number }>("/data-export/requests", { password, code: code || undefined, format, includeFiles })).data,
    onSuccess: (data) => {
      setPassword("");
      setCode("");
      setStarted(true);
      // A plain navigation: the browser downloads the streamed ZIP natively, so a large export never sits in page memory.
      window.location.href = `${apiClient.defaults.baseURL}${data.downloadUrl}`;
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't start the export.")),
  });

  const withheld = [...new Set((contents?.tables ?? []).flatMap((t) => t.omittedColumns))].sort();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Data Export</h1>
        <p className="text-sm text-muted-foreground">Download everything your organization keeps in AccuQual — your records, their history, and the files you uploaded — as a single ZIP.</p>
      </div>

      <AdminOnlyGuard>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <form
            className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
            onSubmit={(e) => {
              e.preventDefault();
              setStarted(false);
              request.mutate();
            }}
          >
            <SelectField label="Format" value={format} onChange={(e) => setFormat(e.target.value as "json" | "csv")}>
              <option value="json">JSON Lines — complete, one record per line (best for moving data to another system)</option>
              <option value="csv">CSV — opens in Excel (nested form contents appear as JSON text in one cell)</option>
            </SelectField>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={includeFiles} onChange={(e) => setIncludeFiles(e.target.checked)} />
              <span>
                Include uploaded files
                <span className="block text-xs text-muted-foreground">Attachments, certificates and documents. Turn off for a much smaller, faster export of just the records.</span>
              </span>
            </label>

            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <p className="text-sm font-medium">Confirm it's you</p>
              <TextField label="Your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <TextField label="Authenticator code (if you use two-step sign-in)" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
              <p className="text-xs text-muted-foreground">If you normally sign in with single sign-on and have no password, use “Forgot password” on the sign-in page once to set one.</p>
            </div>

            <button type="submit" disabled={request.isPending} className="inline-flex w-fit items-center gap-2 rounded-md bg-button px-4 py-2 text-sm font-medium text-button-foreground disabled:opacity-60">
              <Download size={15} /> {request.isPending ? "Preparing…" : "Export my data"}
            </button>
            {started && <p className="rounded-md border border-success/40 bg-success/10 p-2 text-sm">Your download is starting. The link works once and expires in two minutes; if nothing arrives, request the export again. Large exports can take a while to begin streaming.</p>}
          </form>

          <aside className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-sm">
            <h2 className="font-medium">What you'll get</h2>
            {!contents ? (
              <p className="text-muted-foreground">Counting…</p>
            ) : (
              <>
                <p>
                  <strong>{contents.tables.length}</strong> record types, <strong>{contents.totalRows.toLocaleString()}</strong> records in total, exactly as they are the moment the export starts.
                </p>
                <button type="button" onClick={() => setShowTables((s) => !s)} className="w-fit text-xs text-primary hover:underline">
                  {showTables ? "Hide the list" : "Show every record type"}
                </button>
                {showTables && (
                  <ul className="max-h-64 overflow-y-auto rounded-md border border-border p-2 text-xs">
                    {contents.tables.map((t) => (
                      <li key={t.table} className="flex justify-between gap-2 py-0.5">
                        <span className="font-mono">{t.table}</span>
                        <span className="tabular-nums text-muted-foreground">{t.rows.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Never included</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Credentials are withheld: password hashes, two-step sign-in secrets, API keys, tokens, and the like ({withheld.length} column name{withheld.length === 1 ? "" : "s"} across all tables). The export lists each one it left out.
                  </p>
                  {contents.excluded.map((e) => (
                    <p key={e.table} className="mt-1 text-xs text-muted-foreground">
                      <span className="font-mono">{e.table}</span>: {e.reason}
                    </p>
                  ))}
                </div>
              </>
            )}
            <p className="border-t border-border pt-2 text-xs text-muted-foreground">Each export is recorded in the audit trail with who ran it and what it contained.</p>
          </aside>
        </div>
      </AdminOnlyGuard>
    </div>
  );
}
