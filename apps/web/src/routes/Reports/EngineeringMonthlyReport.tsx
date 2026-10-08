import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { SelectField, TextAreaField, TextField } from "../../components/forms/Field";
import { PdfExportActions } from "../../components/records/PdfExportActions";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage, extractErrorMessageAsync } from "../../hooks/useWorkflowAction";
import { ClaimsReturnsChart, EmailIssuesChart, FuelPumpChart, VehicleChart } from "./engineeringReportCharts";
import { ReportRecipientsField, type RecipientPerson } from "../../components/reports/ReportRecipientsField";

type Status = "" | "green" | "yellow" | "red";

interface QaItem {
  problem: string;
  response: string;
}

interface Narrative {
  departmentStatus: Status;
  primaryAchievement: string;
  criticalRisk: string;
  payoutPolicy: string;
  rca: string;
  recommendation: string;
  productAlertNotes: string;
  quarantineNotes: string;
  recallsNotes: string;
  emailIssuesNotes: string;
  fieldQuestions: string;
  palletNotes: string;
  techLine: QaItem[];
  fitment: QaItem[];
  productInfo: QaItem[];
}

interface Gated<T> {
  status: "ok" | "no_access" | "unavailable";
  data?: T;
  reason?: string;
}

interface ReportView {
  documentId: string;
  revision: string;
  documentTitle: string;
  title: string;
  year: number;
  month: number;
  saved: boolean;
  uploadFileName: string | null;
  canEdit: boolean;
  recipients?: string[];
  narrative: Narrative;
  executive: {
    rawClaimCount: number | null;
    trackerProcessed: number | null;
    fuelPumpReturns: { source: string; count: number }[];
    totalAmountRequested: number | null;
    partsAmountRequested: number | null;
    laborAmountRequested: number | null;
    potentialLiability: number | null;
    potentialLiabilityDerived: boolean;
    flatRate: number | null;
    claimsDenied: number | null;
    claimsApproved: number | null;
    claimsPending: number | null;
    deniedLaborSavings: number | null;
    deniedLaborSavingsDerived: boolean;
  };
  tables: {
    months: { key: string; label: string }[];
    metrics: { totalClaims: Array<number | null>; totalProductAlerts: Array<number | null> };
    financials: { total: Array<number | null>; parts: Array<number | null>; labor: Array<number | null> };
    warranty: { ratio: Array<string | null>; mttfDays: Array<number | null>; medianDays: Array<number | null> };
    topParts: { partNumber: string; description: string; totalClaims: number }[];
    fai: {
      source: "supplier" | "accuqual" | "none";
      rows: { category: string; totalCompleted: number; passed: number; failed: number; passedWithDeviation: number }[];
      inAppOpen: number | null;
    };
  };
  charts: {
    claimsSeriesScope: "month" | "file" | "empty";
    claimsReturns: { date: string; claims: number; returns: number }[];
    fuelPumpReturns: { source: string; count: number }[];
    topVehicles: { vehicle: string; claims: number }[];
    emailIssues: { label: string; totalIssues: number | null; orIssues: number | null; napaIssues: number | null }[];
  };
  labor: { mttfDays: number | null; medianDays: number | null };
  productAlerts: {
    total: number | null;
    open: number | null;
    hoursSpent: number | null;
    avgDaysToClose: number | null;
    documentCount: Gated<{ count: number }>;
  };
  sections: {
    pir: { note: string };
  };
  live: {
    ncr: Gated<{ total: number; open: number; closed: number; rows: { id: number; number: string; partNumber: string; description: string; disposition: string; status: string }[] }>;
    cars: Gated<{ scar: number | null; capa: number | null }>;
    rpn: Gated<{ count: number }>;
    quarantine: Gated<{ rows: { id: number; label: string; quantity: string; reason: string; status: string }[] }>;
    recallDocuments: Gated<{ count: number }>;
    fai: Gated<{ open: number }>;
  };
}

interface HelpDoc {
  note: string;
  datasets: { dataset: string; purpose: string; columns: string[] }[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function previousPeriod(): { year: number; month: number } {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function money(value: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function plain(value: number | string | null | undefined): string {
  if (value == null || value === "") return "—";
  return String(value);
}

function gateText(gate: Gated<{ count: number }> | undefined): string {
  if (!gate) return "—";
  if (gate.status === "no_access") return "No access";
  if (gate.status === "unavailable") return gate.reason ?? "Unavailable";
  return String(gate.data?.count ?? 0);
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function Section({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-base font-semibold">
        {number} {title}
      </h3>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function TrendTable({ months, rows }: { months: { key: string; label: string }[]; rows: { label: string; values: Array<string> }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-foreground">
            <th className="p-2 font-semibold">Metric</th>
            {months.map((month) => (
              <th key={month.key} className="p-2 font-semibold">
                {month.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-border last:border-0">
              <td className="p-2">{row.label}</td>
              {row.values.map((value, index) => (
                <td key={`${row.label}-${months[index]?.key ?? index}`} className="p-2">
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QaEditor({
  label,
  items,
  disabled,
  onChange,
}: {
  label: string;
  items: QaItem[];
  disabled: boolean;
  onChange: (items: QaItem[]) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        <button type="button" className="qe-no-print text-xs text-primary" disabled={disabled} onClick={() => onChange([...items, { problem: "", response: "" }])}>
          Add question
        </button>
      </div>
      {items.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
      {items.map((item, index) => (
        <div key={index} className="grid gap-2 rounded-md border border-border p-2">
          <TextAreaField allowPictures={false} label="Problem" rows={2} value={item.problem} disabled={disabled} onChange={(event) => onChange(items.map((row, rowIndex) => (rowIndex === index ? { ...row, problem: event.target.value } : row)))} />
          <TextAreaField allowPictures={false} label="Response" rows={2} value={item.response} disabled={disabled} onChange={(event) => onChange(items.map((row, rowIndex) => (rowIndex === index ? { ...row, response: event.target.value } : row)))} />
          <button type="button" className="qe-no-print self-start text-xs text-destructive" disabled={disabled} onClick={() => onChange(items.filter((_, rowIndex) => rowIndex !== index))}>
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

export function EngineeringMonthlyReport() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const initial = previousPeriod();
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [narrative, setNarrative] = useState<Narrative | null>(null);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [recipientsDirty, setRecipientsDirty] = useState(false);
  const [replaceNotes, setReplaceNotes] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [exportId, setExportId] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const report = useQuery({
    queryKey: ["engineering-report", year, month],
    queryFn: async () => (await apiClient.get<ReportView>("/reports/engineering", { params: { year, month } })).data,
  });

  const help = useQuery({
    queryKey: ["engineering-report-help"],
    enabled: helpOpen,
    queryFn: async () => (await apiClient.get<HelpDoc>("/reports/engineering/help")).data,
  });

  const people = useQuery({
    queryKey: ["engineering-report-people"],
    enabled: report.isSuccess,
    queryFn: async () => (await apiClient.get<RecipientPerson[]>("/reports/engineering/people")).data,
  });

  useEffect(() => {
    setDirty(false);
    setRecipientsDirty(false);
    setWarnings([]);
    setExportId(null);
  }, [year, month]);

  useEffect(() => {
    if (report.data && !dirty) setNarrative(report.data.narrative);
  }, [report.data, dirty]);

  useEffect(() => {
    if (report.data && !recipientsDirty) setRecipients(report.data.recipients ?? []);
  }, [report.data, recipientsDirty]);

  const save = useMutation({
    mutationFn: async () => {
      if (!narrative) throw new Error("The report is still loading.");
      return (await apiClient.put<ReportView>("/reports/engineering", { year, month, narrative, recipients })).data;
    },
    onSuccess: async (next) => {
      setNarrative(next.narrative);
      setRecipients(next.recipients ?? []);
      setDirty(false);
      setRecipientsDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["engineering-report", year, month] });
      toast.success("Narrative saved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "The narrative didn't save.")),
  });

  const emailNow = useMutation({
    mutationFn: async () => {
      if (!narrative) throw new Error("The report is still loading.");
      return (await apiClient.post<{ report: ReportView; deliveries: { to: string; status: string }[] }>("/reports/engineering/email", { year, month, narrative, recipients })).data;
    },
    onSuccess: async (result) => {
      setNarrative(result.report.narrative);
      setRecipients(result.report.recipients ?? []);
      setDirty(false);
      setRecipientsDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["engineering-report", year, month] });
      const failed = result.deliveries.filter((row) => row.status === "failed");
      if (failed.length === 0) toast.success(`Report sent to ${result.deliveries.length} recipient${result.deliveries.length === 1 ? "" : "s"}.`);
      else toast.error(`Sent to ${result.deliveries.length - failed.length}. Failed: ${failed.map((row) => row.to).join(", ")}`);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "The report didn't send.")),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.set("file", file);
      body.set("year", String(year));
      body.set("month", String(month));
      body.set("replaceNotes", replaceNotes ? "true" : "false");
      return (await apiClient.post<{ report: ReportView; warnings: string[] }>("/reports/engineering/upload", body, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: async (result) => {
      setNarrative(result.report.narrative);
      setRecipients(result.report.recipients ?? []);
      setDirty(false);
      setRecipientsDirty(false);
      setWarnings(result.warnings);
      await queryClient.invalidateQueries({ queryKey: ["engineering-report", year, month] });
      toast.success("Supplier file loaded.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "The supplier file didn't load.")),
  });

  function patch(partial: Partial<Narrative>) {
    setNarrative((current) => (current ? { ...current, ...partial } : current));
    setDirty(true);
  }

  async function downloadTemplate() {
    try {
      const res = await apiClient.get("/reports/engineering/template.csv", { responseType: "blob" });
      downloadBlob(res.data as Blob, "quality-engineering-supplier-august-2026.csv");
    } catch (err) {
      toast.error(await extractErrorMessageAsync(err, "The template didn't download."));
    }
  }

  async function downloadPdf() {
    try {
      const res = await apiClient.get("/reports/engineering/pdf", { params: { year, month }, responseType: "blob" });
      const header = String(res.headers["content-disposition"] ?? "");
      const match = /filename="([^"]+)"/.exec(header);
      downloadBlob(res.data as Blob, match?.[1] ?? `quality-engineering-${year}-${month}.pdf`);
      const exportHeader = res.headers["x-export-id"];
      setExportId(typeof exportHeader === "string" && exportHeader.startsWith("exp_") ? exportHeader : null);
    } catch (err) {
      toast.error(await extractErrorMessageAsync(err, "The PDF didn't download."));
    }
  }

  const view = report.data;
  const locked = !view?.canEdit;
  const status = narrative?.departmentStatus ?? "";
  const statusClass =
    status === "green"
      ? "border border-success/40 bg-success/15 text-success"
      : status === "yellow"
        ? "border border-warning/40 bg-warning/15 text-warning"
        : status === "red"
          ? "border border-destructive/40 bg-destructive/15 text-destructive"
          : "bg-muted text-foreground";

  const quarantineRows = view?.live.quarantine.status === "ok" ? view.live.quarantine.data?.rows ?? [] : [];
  const ncr = view?.live.ncr;

  return (
    <div className="qe-report flex flex-col gap-4">
      <style>{`@media print { body * { visibility: hidden; } .qe-report, .qe-report * { visibility: visible; } .qe-report { position: absolute; left: 0; top: 0; width: 100%; background: white; color: black; } .qe-no-print { display: none !important; } }`}</style>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {view ? `${view.documentId} · Rev ${view.revision}` : "TMP-ENG-001 · Rev C"}
        </p>
        <h2 className="text-lg font-semibold">{view?.title ?? "Monthly Quality Report"}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Pick the month, upload the supplier workbook, then edit the narrative. Charts and claim dollars come from that file. NCR, quarantine, first articles, and document counts come from AccuQual when you can read those modules.
        </p>
      </div>

      <div className="qe-no-print flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <SelectField label="Month" value={String(month)} onChange={(event) => setMonth(Number(event.target.value))}>
            {MONTHS.map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </SelectField>
          <TextField label="Year" type="number" min={2000} max={2100} value={year} onChange={(event) => setYear(Number(event.target.value))} />
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" checked={replaceNotes} onChange={(event) => setReplaceNotes(event.target.checked)} />
            Replace narrative already typed
          </label>
          <div className="flex items-end">
            <label className="flex w-full cursor-pointer flex-col gap-1 text-sm">
              <span className="text-xs font-semibold text-muted-foreground">Supplier file (CSV or Excel)</span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={locked || upload.isPending}
                className="text-sm"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) upload.mutate(file);
                }}
              />
            </label>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <ReportRecipientsField
            label="Email recipients"
            value={recipients}
            people={people.data ?? []}
            disabled={locked}
            onChange={(next) => {
              setRecipients(next);
              setRecipientsDirty(true);
            }}
          />
          <button type="button" className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60" disabled={locked || save.isPending || !narrative} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save narrative"}
          </button>
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-60" disabled={locked || emailNow.isPending || recipients.length === 0 || !narrative} onClick={() => emailNow.mutate()}>
            {emailNow.isPending ? "Sending…" : "Email now"}
          </button>
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => void downloadTemplate()}>
            Download sample CSV
          </button>
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => void downloadPdf()}>
            Download PDF
          </button>
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => window.print()}>
            Print
          </button>
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => setHelpOpen((open) => !open)}>
            {helpOpen ? "Hide column help" : "Supplier column help"}
          </button>
        </div>
        {view?.uploadFileName && <p className="text-sm text-muted-foreground">Last supplier file: {view.uploadFileName}</p>}
        {locked && view && <p className="text-sm text-muted-foreground">You can read this report. Saving and uploading need edit access on a quality module an admin has granted.</p>}
        {report.isError && <p className="text-sm text-destructive">{extractErrorMessage(report.error, "The report didn't load.")}</p>}
        {warnings.length > 0 && (
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
        <PdfExportActions exportId={exportId} entityType="quality_engineering_report" />
        {helpOpen && (
          <div className="text-sm">
            <p>{help.data?.note}</p>
            <ul className="mt-2 flex flex-col gap-2">
              {(help.data?.datasets ?? []).map((dataset) => (
                <li key={dataset.dataset}>
                  <span className="font-semibold">{dataset.dataset}</span> — {dataset.purpose} Columns: {dataset.columns.join(", ")}.
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {view && narrative && (
        <>
          <Section number="6.1" title="Executive Summary">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`rounded-full px-3 py-1 text-sm font-semibold ${statusClass}`}>{status ? status.toUpperCase() : "NO STATUS"}</span>
              <SelectField label="Status of department" value={narrative.departmentStatus} disabled={locked} onChange={(event) => patch({ departmentStatus: event.target.value as Status })}>
                <option value="">Not set</option>
                <option value="green">Green</option>
                <option value="yellow">Yellow</option>
                <option value="red">Red</option>
              </SelectField>
            </div>
            <TextAreaField allowPictures={false} label="Primary achievement" value={narrative.primaryAchievement} disabled={locked} onChange={(event) => patch({ primaryAchievement: event.target.value })} />
            <TextAreaField allowPictures={false} label="Critical risk / blocker" value={narrative.criticalRisk} disabled={locked} onChange={(event) => patch({ criticalRisk: event.target.value })} />
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Total claims</dt>
                <dd>
                  {plain(view.executive.rawClaimCount)} raw
                  {view.executive.trackerProcessed != null ? ` / ${view.executive.trackerProcessed} in the tracker` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Fuel pump returns</dt>
                <dd>{view.executive.fuelPumpReturns.length === 0 ? "—" : view.executive.fuelPumpReturns.map((row) => `${row.source}: ${row.count}`).join(" · ")}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Total requested</dt>
                <dd>{money(view.executive.totalAmountRequested)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Parts requested</dt>
                <dd>{money(view.executive.partsAmountRequested)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Labor requested</dt>
                <dd>{money(view.executive.laborAmountRequested)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Potential liability</dt>
                <dd>
                  {money(view.executive.potentialLiability)}
                  {view.executive.potentialLiabilityDerived ? " (claim count × flat rate)" : ""}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Flat rate</dt>
                <dd>{view.executive.flatRate == null ? "—" : money(view.executive.flatRate)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Approved / denied / pending</dt>
                <dd>
                  {plain(view.executive.claimsApproved)} / {plain(view.executive.claimsDenied)} / {plain(view.executive.claimsPending)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Denied labor savings</dt>
                <dd>
                  {money(view.executive.deniedLaborSavings)}
                  {view.executive.deniedLaborSavingsDerived ? " (denied × flat rate)" : ""}
                </dd>
              </div>
            </dl>
            <TextAreaField allowPictures={false} label="Payout policy" value={narrative.payoutPolicy} disabled={locked} onChange={(event) => patch({ payoutPolicy: event.target.value })} />
          </Section>

          <Section number="" title="Trend tables">
            <TrendTable
              months={view.tables.months}
              rows={[
                { label: "Total Claims", values: view.tables.metrics.totalClaims.map(plain) },
                { label: "Total Product Alerts", values: view.tables.metrics.totalProductAlerts.map(plain) },
              ]}
            />
            <TrendTable
              months={view.tables.months}
              rows={[
                { label: "Total Amount Requested", values: view.tables.financials.total.map(money) },
                { label: "Parts Amount Requested", values: view.tables.financials.parts.map(money) },
                { label: "Labor Amount Requested", values: view.tables.financials.labor.map(money) },
              ]}
            />
            <TrendTable
              months={view.tables.months}
              rows={[
                { label: "Labor-to-Parts Ratio", values: view.tables.warranty.ratio.map(plain) },
                { label: "Mean Time to Failure", values: view.tables.warranty.mttfDays.map((value) => (value == null ? "—" : `${value} days`)) },
                { label: "Median Time to Failure", values: view.tables.warranty.medianDays.map((value) => (value == null ? "—" : `${value} days`)) },
              ]}
            />
          </Section>

          <Section number="6.2" title="Labor Claims">
            <p className="text-sm">
              Mean time to failure: {view.labor.mttfDays == null ? "—" : `${view.labor.mttfDays} days`}. Median time to failure: {view.labor.medianDays == null ? "—" : `${view.labor.medianDays} days`}.
            </p>
            <h4 className="text-sm font-semibold">Claims and returns</h4>
            <ClaimsReturnsChart rows={view.charts.claimsReturns} scope={view.charts.claimsSeriesScope} />
            <h4 className="text-sm font-semibold">Top returning parts</h4>
            {view.tables.topParts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No supplier parts uploaded.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-foreground">
                    <th className="p-2">Part number</th>
                    <th className="p-2">Description / application</th>
                    <th className="p-2">Total claims</th>
                  </tr>
                </thead>
                <tbody>
                  {view.tables.topParts.map((row) => (
                    <tr key={row.partNumber} className="border-b border-border last:border-0">
                      <td className="p-2">{row.partNumber}</td>
                      <td className="p-2">{row.description || "—"}</td>
                      <td className="p-2">{row.totalClaims}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <h4 className="text-sm font-semibold">Fuel pump returns</h4>
            <FuelPumpChart rows={view.charts.fuelPumpReturns} />
            <h4 className="text-sm font-semibold">Top vehicle models</h4>
            <VehicleChart rows={view.charts.topVehicles} />
            <TextAreaField allowPictures={false} label="Root cause analysis" value={narrative.rca} disabled={locked} onChange={(event) => patch({ rca: event.target.value })} />
            <TextAreaField allowPictures={false} label="Recommendation" value={narrative.recommendation} disabled={locked} onChange={(event) => patch({ recommendation: event.target.value })} />
          </Section>

          <Section number="6.3" title="Product Alerts">
            <dl className="grid gap-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Supplier total</dt>
                <dd>{plain(view.productAlerts.total)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Open</dt>
                <dd>{plain(view.productAlerts.open)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Hours spent</dt>
                <dd>{plain(view.productAlerts.hoursSpent)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Avg days to close</dt>
                <dd>{plain(view.productAlerts.avgDaysToClose)}</dd>
              </div>
            </dl>
            <p className="text-sm">Product alert documents filed this month: {gateText(view.productAlerts.documentCount)}</p>
            <TextAreaField allowPictures={false} label="Notes" value={narrative.productAlertNotes} disabled={locked} onChange={(event) => patch({ productAlertNotes: event.target.value })} />
          </Section>

          <Section number="6.4" title="Quarantine">
            <p className="text-sm">
              {view.live.quarantine.status === "no_access"
                ? "No access to quarantine."
                : view.live.quarantine.status === "unavailable"
                  ? view.live.quarantine.reason
                  : quarantineRows.length === 0
                    ? "No new parts quarantined."
                    : `${quarantineRows.length} hold${quarantineRows.length === 1 ? "" : "s"} opened this month.`}
            </p>
            {quarantineRows.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-foreground">
                    <th className="p-2">Item</th>
                    <th className="p-2">Quantity</th>
                    <th className="p-2">Reason</th>
                    <th className="p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {quarantineRows.map((row) => (
                    <tr key={row.id} className="border-b border-border last:border-0">
                      <td className="p-2">{row.label}</td>
                      <td className="p-2">{row.quantity}</td>
                      <td className="p-2">{row.reason}</td>
                      <td className="p-2">{row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <TextAreaField allowPictures={false} label="Notes" value={narrative.quarantineNotes} disabled={locked} onChange={(event) => patch({ quarantineNotes: event.target.value })} />
          </Section>

          <Section number="6.5" title="First Article Verifications">
            <p className="text-sm text-muted-foreground">
              {view.tables.fai.source === "supplier" ? "Category totals are from the supplier file." : view.tables.fai.source === "accuqual" ? "Category totals are first articles opened in AccuQual this month." : "No supplier FAI sheet, and no completed first articles this month."}
              {view.tables.fai.inAppOpen ? ` ${view.tables.fai.inAppOpen} in-app first article${view.tables.fai.inAppOpen === 1 ? "" : "s"} still open.` : ""}
              {view.live.fai.status === "no_access" ? " In-app first articles are hidden because you can't read that module." : ""}
            </p>
            {view.tables.fai.rows.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-foreground">
                    <th className="p-2">Product category</th>
                    <th className="p-2">Completed</th>
                    <th className="p-2">Passed</th>
                    <th className="p-2">Failed</th>
                    <th className="p-2">Passed w/ deviation</th>
                  </tr>
                </thead>
                <tbody>
                  {view.tables.fai.rows.map((row) => (
                    <tr key={row.category} className="border-b border-border last:border-0">
                      <td className="p-2">{row.category}</td>
                      <td className="p-2">{row.totalCompleted}</td>
                      <td className="p-2">{row.passed}</td>
                      <td className="p-2">{row.failed}</td>
                      <td className="p-2">{row.passedWithDeviation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section number="6.6" title="NCRs, CARs, PIRs, and RPNs">
            <p className="text-sm">
              {ncr?.status === "ok" ? `NCRs logged: ${ncr.data?.total ?? 0} (${ncr.data?.open ?? 0} open, ${ncr.data?.closed ?? 0} closed).` : ncr?.status === "no_access" ? "No access to NCR." : ncr?.reason}
            </p>
            <p className="text-sm">
              {view.live.cars.status === "ok"
                ? `CARs (supplier corrective actions): ${view.live.cars.data?.scar == null ? "no access" : view.live.cars.data.scar}. CAPA records: ${view.live.cars.data?.capa == null ? "no access" : view.live.cars.data.capa}.`
                : view.live.cars.status === "no_access"
                  ? "No access to CAPA or supplier corrective actions."
                  : view.live.cars.reason}
            </p>
            <p className="text-sm">RPNs logged: {view.live.rpn.status === "ok" ? view.live.rpn.data?.count : view.live.rpn.status === "no_access" ? "No access" : view.live.rpn.reason}</p>
            <p className="text-sm">{view.sections.pir.note}</p>
            {ncr?.status === "ok" && (ncr.data?.rows.length ?? 0) > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-foreground">
                      <th className="p-2">NCR number</th>
                      <th className="p-2">Part number</th>
                      <th className="p-2">Description of defect</th>
                      <th className="p-2">Disposition</th>
                      <th className="p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ncr.data?.rows.map((row) => (
                      <tr key={row.id} className="border-b border-border last:border-0">
                        <td className="p-2">{row.number}</td>
                        <td className="p-2">{row.partNumber}</td>
                        <td className="p-2">{row.description}</td>
                        <td className="p-2">{row.disposition || "—"}</td>
                        <td className="p-2">{row.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section number="6.7" title="Recalls">
            <p className="text-sm">Recall documents filed this month: {gateText(view.live.recallDocuments)}</p>
            {!narrative.recallsNotes && view.live.recallDocuments.status === "ok" && view.live.recallDocuments.data?.count === 0 && <p className="text-sm">No new recalls</p>}
            <TextAreaField allowPictures={false} label="Notes" value={narrative.recallsNotes} disabled={locked} onChange={(event) => patch({ recallsNotes: event.target.value })} />
          </Section>

          <Section number="6.8" title="NAPA Tech Line / Collabtic">
            <QaEditor label="Questions" items={narrative.techLine} disabled={locked} onChange={(techLine) => patch({ techLine })} />
          </Section>

          <Section number="6.10" title="OR/NAPA Email Issues">
            <EmailIssuesChart rows={view.charts.emailIssues} />
            <TextAreaField allowPictures={false} label="Notes" value={narrative.emailIssuesNotes} disabled={locked} onChange={(event) => patch({ emailIssuesNotes: event.target.value })} />
          </Section>

          <Section number="6.11" title="Field questions">
            <TextAreaField allowPictures={false} label="Notes" value={narrative.fieldQuestions} disabled={locked} onChange={(event) => patch({ fieldQuestions: event.target.value })} />
          </Section>

          <Section number="6.12" title="Fitment Verification">
            <QaEditor label="Fitment questions" items={narrative.fitment} disabled={locked} onChange={(fitment) => patch({ fitment })} />
          </Section>

          <Section number="6.13" title="Product Information">
            <QaEditor label="Product questions" items={narrative.productInfo} disabled={locked} onChange={(productInfo) => patch({ productInfo })} />
          </Section>

          <Section number="6.14" title="NAPA black label pallet work">
            <TextAreaField allowPictures={false} label="Notes" value={narrative.palletNotes} disabled={locked} onChange={(event) => patch({ palletNotes: event.target.value })} />
          </Section>
        </>
      )}
    </div>
  );
}
