import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { SelectField, TextField } from "../../components/forms/Field";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage, extractErrorMessageAsync } from "../../hooks/useWorkflowAction";
import { useSites } from "../../hooks/useSites";
import { PdfExportActions } from "../../components/records/PdfExportActions";
import { EngineeringMonthlyReport } from "./EngineeringMonthlyReport";

type ReportKind = "weekly" | "monthly" | "adhoc";

interface ReportSection {
  key: string;
  title: string;
  status: "ok" | "skipped" | "no_access";
  reason?: string;
  summary: Record<string, number | string | null>;
  rows: { label: string; value: number | string | null }[];
}

interface QualityReport {
  header: {
    templateVersion: number;
    type: ReportKind;
    title: string;
    dateRange: { from: string; to: string };
    plant: { id: number | null; name: string; scope: "plant" | "all" };
    generatedAt: string;
    generatedBy: { id: number; name: string };
  };
  sections: ReportSection[];
  delivery: {
    pdf: { status: "stub"; message: string };
    email: { status: "stub"; message: string };
  };
}

interface RunBody {
  from?: string;
  to?: string;
  plantId: "all" | number;
}

const KINDS: { key: ReportKind; label: string }[] = [
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "adhoc", label: "Custom dates" },
];

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function ReportsPage({ embedded = false }: { embedded?: boolean }) {
  const toast = useToast();
  const sites = useSites();
  const [kind, setKind] = useState<ReportKind>("weekly");
  const [engineering, setEngineering] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [plantId, setPlantId] = useState("all");
  const [plantTouched, setPlantTouched] = useState(false);
  const [report, setReport] = useState<QualityReport | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exportId, setExportId] = useState<string | null>(null);

  useEffect(() => {
    if (!plantTouched && sites.currentSiteId != null) setPlantId(String(sites.currentSiteId));
  }, [plantTouched, sites.currentSiteId]);

  function body(): RunBody {
    const plant = plantId === "all" ? "all" : Number(plantId);
    if (kind === "adhoc") return { from, to, plantId: plant };
    return { plantId: plant };
  }

  const run = useMutation({
    mutationFn: async () => {
      if (kind === "adhoc" && (!from || !to)) throw new Error("Choose a start date and an end date.");
      const path = kind === "weekly" ? "/reports/weekly" : kind === "monthly" ? "/reports/monthly" : "/reports/adhoc";
      return (await apiClient.post<QualityReport>(path, body())).data;
    },
    onSuccess: (next) => {
      setReport(next);
      setNotice(null);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "The report didn't run.")),
  });

  const [downloading, setDownloading] = useState<string | null>(null);
  async function download(format: "csv" | "json" | "pdf") {
    if (kind === "adhoc" && (!from || !to)) {
      toast.error("Choose a start date and an end date.");
      return;
    }
    setDownloading(format);
    try {
      const res = await apiClient.get("/reports/export", {
        params: { type: kind, format, ...body() },
        responseType: "blob",
      });
      const header = String(res.headers["content-disposition"] ?? "");
      const match = /filename="([^"]+)"/.exec(header);
      downloadBlob(res.data as Blob, match?.[1] ?? `accuqual-${kind}-report.${format}`);
      if (format === "pdf") {
        const header = res.headers["x-export-id"];
        setExportId(typeof header === "string" && header.startsWith("exp_") ? header : null);
        setNotice("PDF ready.");
      }
    } catch (err) {
      toast.error(await extractErrorMessageAsync(err, "The download didn't start."));
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className={embedded ? "flex w-full flex-col gap-6" : "mx-auto flex w-full max-w-5xl flex-col gap-6"}>
      <div>
        {!embedded && <h1 className="text-2xl font-semibold">Reports</h1>}
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Weekly, monthly, and custom quality reports from the records already in NCR, CAPA, receiving, and the other modules. A section you can't read is left out. A section whose table isn't in this database is skipped. Quality / Engineering is the monthly pack (TMP-ENG-001): supplier upload for claim charts, live NCR and quarantine for the month, and a PDF.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {KINDS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              setEngineering(false);
              setKind(item.key);
            }}
            className={!engineering && item.key === kind ? "rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground" : "rounded-md border border-border px-3 py-1.5 text-sm"}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setEngineering(true)}
          className={engineering ? "rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground" : "rounded-md border border-border px-3 py-1.5 text-sm"}
        >
          Quality / Engineering
        </button>
      </div>

      {engineering ? (
        <EngineeringMonthlyReport />
      ) : (
      <form
        className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault();
          setNotice(null);
          run.mutate();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField
            label="Plant"
            value={plantId}
            onChange={(event) => {
              setPlantTouched(true);
              setPlantId(event.target.value);
            }}
          >
            <option value="all">All plants</option>
            {(sites.data?.sites ?? []).map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </SelectField>
          {kind === "adhoc" && (
            <>
              <TextField label="From" type="date" value={from} onChange={(event) => setFrom(event.target.value)} required />
              <TextField label="To" type="date" value={to} onChange={(event) => setTo(event.target.value)} required />
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={run.isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
            {run.isPending ? "Running…" : "Run report"}
          </button>
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => void download("csv")}>
            Download CSV
          </button>
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => void download("json")}>
            Download JSON
          </button>
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-60" disabled={downloading === "pdf"} onClick={() => void download("pdf")}>
            {downloading === "pdf" ? "Preparing PDF…" : "PDF"}
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm"
            onClick={() => {
              void apiClient.get<{ message: string }>("/reports/schedule").then(
                (res) => setNotice(res.data.message),
                (err) => toast.error(extractErrorMessage(err, "The schedule isn't available.")),
              );
            }}
          >
            Email schedule
          </button>
        </div>
        {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
        <PdfExportActions exportId={exportId} entityType="quality_report" />
      </form>
      )}

      {!engineering && report && (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-lg font-semibold">{report.header.title}</h2>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Type</dt>
                <dd>{report.header.type}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Template</dt>
                <dd>Version {report.header.templateVersion}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Date range</dt>
                <dd>
                  {report.header.dateRange.from.slice(0, 10)} – {report.header.dateRange.to.slice(0, 10)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Plant</dt>
                <dd>{report.header.plant.name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Generated</dt>
                <dd>
                  {formatWhen(report.header.generatedAt)} by {report.header.generatedBy.name}
                </dd>
              </div>
            </dl>
          </div>
          {report.sections.map((section) => (
            <section key={section.key} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-semibold">{section.title}</h3>
                {section.status !== "ok" && <span className="text-xs uppercase tracking-wide text-muted-foreground">{section.status === "no_access" ? "No access" : "Skipped"}</span>}
              </div>
              {section.reason && <p className="mt-1 text-sm text-muted-foreground">{section.reason}</p>}
              {section.status === "ok" && (
                <>
                  {Object.keys(section.summary).length > 0 && (
                    <dl className="mt-3 grid gap-2 sm:grid-cols-3">
                      {Object.entries(section.summary).map(([label, value]) => (
                        <div key={label}>
                          <dt className="text-xs text-muted-foreground">{label}</dt>
                          <dd className="text-sm font-medium">{value == null ? "—" : String(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {section.rows.length > 0 && (
                    <ul className="mt-3 divide-y divide-border text-sm">
                      {section.rows.slice(0, 24).map((row) => (
                        <li key={row.label} className="flex justify-between gap-3 py-1">
                          <span>{row.label}</span>
                          <span className="font-medium">{row.value == null ? "—" : String(row.value)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {section.rows.length > 24 && <p className="mt-2 text-xs text-muted-foreground">Showing 24 of {section.rows.length}. The download has the rest.</p>}
                </>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
