import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { criteriaForBranch, type FpmCriterion } from "../../../../../services/api/src/modules/fuel-pump-fai/fuelPumpFai.logic";

interface FuelPumpListRow {
  id: number;
  number: string;
  partNumber: string;
  supplier: string;
  status: string;
  stage: string;
  productionRelease: string;
  slaStatus: string | null;
  locked: string;
}

interface FuelPumpRoute {
  decision: string;
  label: string;
  branch: string;
  commentsRequired?: boolean;
}

interface FuelPumpResultRow {
  key: string;
  branch: string;
  label: string;
  result: string;
  actual: string | null;
  units: string | null;
  specifiedLimits: string | null;
  comments: string | null;
  critical: boolean;
  photos: { fileName: string; caption?: string }[];
}

interface FuelPumpRecord {
  id: number;
  number: string;
  partNumber: string;
  partDescription: string;
  supplier: string;
  supplierPartNumber: string;
  sampleLotNumber: string;
  vehicleYear: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleEngine: string;
  application: string;
  inspector: string;
  validationOwner: string;
  qualityManager: string;
  status: string;
  stage: string;
  productFamily: string;
  productionRelease: string;
  ncrRequired: string;
  failureDetected: string;
  ncrId: number | null;
  workflowRunId: number | null;
  attemptNumber: number;
  locked: string;
  slaStatus: string | null;
  outcomeLabel: string | null;
  outcomeDisplay: string | null;
  overallResult: string | null;
  flowRateResult: string | null;
  pressureResult: string | null;
  currentDrawResult: string | null;
  electricalResult: string | null;
  fitmentResult: string | null;
  packagingResult: string | null;
  attempt: { number: number; results: FuelPumpResultRow[]; totals: { criteria: number; passed: number; failed: number; engineeringReviewRequired: number } | null; overall: string | null };
  history: { number: number; overall: string | null; results: FuelPumpResultRow[] }[];
  correctiveAction: { rootCause: string; correctiveAction: string; responsiblePerson: string; dueDate: string } | null;
  pendingApproval?: {
    nodeId: string;
    label?: string;
    message?: string;
    branch?: "visual" | "dimensional" | "electrical" | "functional" | "fitment" | "packaging";
    pauseUntil?: string;
    routes?: FuelPumpRoute[];
  } | null;
}

const BLANK = {
  partNumber: "",
  partDescription: "",
  supplier: "",
  supplierPartNumber: "",
  sampleLotNumber: "",
  vehicleYear: "",
  vehicleMake: "",
  vehicleModel: "",
  vehicleEngine: "",
  application: "",
  inspector: "",
  validationOwner: "",
  qualityManager: "",
  dateOpened: new Date().toISOString().slice(0, 10),
};

async function downloadFuelPumpPdf(id: number, number: string) {
  const response = await apiClient.get(`/fai/fuel-pump/${id}/pdf`, { responseType: "blob" });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${number}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}

export function FuelPumpFaiListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["fuel-pump-fai"], queryFn: async () => (await apiClient.get<FuelPumpListRow[]>("/fai/fuel-pump")).data });
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState<string | null>(null);
  const submit = useMutation({
    mutationFn: async () => (await apiClient.post<FuelPumpRecord>("/fai/fuel-pump", form)).data,
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["fuel-pump-fai"] });
      navigate(`/fai/fuel-pump/${created.id}`);
    },
    onError: (err) => setError(extractErrorMessage(err, "The fuel pump first article could not be submitted.")),
  });
  const fields: [keyof typeof BLANK, string, boolean][] = [
    ["partNumber", "Part number", true],
    ["partDescription", "Part description", false],
    ["supplier", "Supplier", true],
    ["supplierPartNumber", "Supplier part number", false],
    ["sampleLotNumber", "Sample lot number", true],
    ["vehicleYear", "Vehicle year", false],
    ["vehicleMake", "Make", false],
    ["vehicleModel", "Model", false],
    ["vehicleEngine", "Engine", false],
    ["application", "Vehicle application", true],
    ["inspector", "Inspector", true],
    ["validationOwner", "Validation owner", false],
    ["qualityManager", "Quality manager", false],
    ["dateOpened", "Date opened", false],
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Fuel Pump Module FAI</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">Aftermarket fuel pump first article inspection. The workflow stays a draft until it is published. A failed pump cannot be released to production. Limits come from the approved drawing, specification, or inspection plan.</p>
        </div>
        <Link to="/fai" className="text-sm text-primary hover:underline">First Article queue</Link>
      </div>
      <form
        className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          submit.mutate();
        }}
      >
        <h2 className="sm:col-span-2 text-sm font-medium">Submit a fuel pump FAI</h2>
        {fields.map(([key, label, required]) => (
          <label key={key} className="flex flex-col gap-1 text-sm">
            <span>{label}{required ? " *" : ""}</span>
            <input
              required={required}
              type={key === "dateOpened" ? "date" : "text"}
              className="rounded-md border border-border bg-background p-2"
              value={form[key]}
              onChange={(event) => setForm({ ...form, [key]: event.target.value })}
            />
          </label>
        ))}
        {error && <p className="sm:col-span-2 text-sm text-destructive">{error}</p>}
        <button type="submit" disabled={submit.isPending} className="sm:col-span-2 w-fit rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
          Submit fuel pump FAI
        </button>
      </form>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2">Number</th>
            <th>Part</th>
            <th>Supplier</th>
            <th>Status</th>
            <th>Stage</th>
            <th>Production release</th>
          </tr>
        </thead>
        <tbody>
          {(list.data ?? []).map((row) => (
            <tr key={row.id} className="border-b border-border">
              <td className="py-2"><Link to={`/fai/fuel-pump/${row.id}`} className="text-primary hover:underline">{row.number}</Link></td>
              <td>{row.partNumber}</td>
              <td>{row.supplier}</td>
              <td><StatusBadge value={row.status} /></td>
              <td>{row.stage}</td>
              <td>{row.productionRelease}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.data?.length === 0 && <p className="text-sm text-muted-foreground">No fuel pump first articles yet.</p>}
    </div>
  );
}

function draftFrom(criterion: FpmCriterion, existing: FuelPumpResultRow | undefined) {
  return {
    result: existing?.result && existing.result !== "Engineering Review Required" ? existing.result : "Pass",
    actual: existing?.actual ?? "",
    units: existing?.units ?? "",
    specifiedLimits: existing?.specifiedLimits ?? "",
    comments: existing?.comments ?? "",
    photo: existing?.photos[0]?.fileName ?? "",
    critical: existing?.critical ?? false,
  };
}

export function FuelPumpFaiRecordPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const record = useQuery({
    queryKey: ["fuel-pump-fai", id],
    queryFn: async () => (await apiClient.get<FuelPumpRecord>(`/fai/fuel-pump/${id}`)).data,
    enabled: Boolean(id),
  });
  const data = record.data;
  const pending = data?.pendingApproval;
  const branch = pending?.branch;
  const criteria = useMemo(() => (branch ? criteriaForBranch(branch) : []), [branch]);
  const [drafts, setDrafts] = useState<Record<string, ReturnType<typeof draftFrom>>>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [rejectedBy, setRejectedBy] = useState("");
  const [rejectionDate, setRejectionDate] = useState("");
  const [limits, setLimits] = useState("");
  const [correction, setCorrection] = useState({ partNumber: "", partDescription: "", supplier: "", supplierPartNumber: "", sampleLotNumber: "", vehicleYear: "", vehicleMake: "", vehicleModel: "", vehicleEngine: "", application: "", inspector: "", validationOwner: "", qualityManager: "" });
  const [action, setAction] = useState({ rootCause: "", correctiveAction: "", responsiblePerson: "", dueDate: "" });
  const [error, setError] = useState<string | null>(null);

  if (data && loadedFor !== `${data.id}:${data.attemptNumber}:${branch ?? ""}`) {
    const next: Record<string, ReturnType<typeof draftFrom>> = {};
    for (const criterion of criteria) next[criterion.key] = draftFrom(criterion, data.attempt.results.find((row) => row.key === criterion.key));
    setDrafts(next);
    setLoadedFor(`${data.id}:${data.attemptNumber}:${branch ?? ""}`);
  }

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["fuel-pump-fai", id] });
    await queryClient.invalidateQueries({ queryKey: ["fuel-pump-fai"] });
  };
  const saveResults = useMutation({
    mutationFn: async () => {
      const entries = criteria.map((criterion) => {
        const draft = drafts[criterion.key];
        return {
          key: criterion.key,
          result: draft?.result,
          actual: draft?.actual || null,
          units: draft?.units || null,
          specifiedLimits: draft?.specifiedLimits || null,
          comments: draft?.comments || null,
          critical: draft?.critical === true,
          photos: draft?.photo ? [{ fileName: draft.photo }] : [],
        };
      });
      return (await apiClient.put(`/fai/fuel-pump/${id}/results`, { branch, entries })).data;
    },
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError: (err) => setError(extractErrorMessage(err, "The inspection results could not be saved.")),
  });
  const decide = useMutation({
    mutationFn: async (decision: string) => {
      const details: Record<string, unknown> = {};
      if (decision === "rejected") {
        details.rejectionReason = notes;
        details.rejectedBy = rejectedBy;
        details.rejectionDate = rejectionDate;
      }
      if (pending?.pauseUntil === "correctionReady") {
        details.correctionComments = notes;
        details.changes = correction;
      }
      if (pending?.pauseUntil === "correctiveActionReady") details.correctiveAction = action;
      if (decision === "retest" && limits.trim()) {
        details.limits = (data?.attempt.results ?? [])
          .filter((row) => row.result === "Engineering Review Required")
          .map((row) => ({ key: row.key, specifiedLimits: limits.trim(), units: row.units }));
      }
      return (await apiClient.post(`/workflow/runs/${data?.workflowRunId}/decision`, { decision, notes: notes || undefined, details })).data;
    },
    onSuccess: async () => {
      setError(null);
      setNotes("");
      await refresh();
    },
    onError: (err) => setError(extractErrorMessage(err, "That decision could not be recorded.")),
  });

  if (record.isLoading) return <p className="text-sm text-muted-foreground">Loading fuel pump first article…</p>;
  if (!data) return <p className="text-sm text-destructive">This fuel pump first article could not be opened.</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground"><Link to="/fai/fuel-pump" className="text-primary hover:underline">Fuel pump first articles</Link></p>
          <h1 className="text-2xl font-semibold">{data.number}</h1>
          <p className="text-sm">{data.partNumber}{data.partDescription ? ` — ${data.partDescription}` : ""}</p>
          <p className="text-sm text-muted-foreground">{data.supplier} · {data.application} · {data.productFamily}</p>
        </div>
        <div className="flex flex-col items-end gap-2 text-sm">
          <StatusBadge value={data.status} />
          <span>Stage: {data.stage}</span>
          <span>Production release: {data.productionRelease}</span>
          {data.slaStatus && <span>SLA: {data.slaStatus}</span>}
          {(data.status === "Approved" || data.status === "Closed") && (
            <button type="button" className="rounded-md border border-border px-3 py-1.5" onClick={() => void downloadFuelPumpPdf(data.id, data.number)}>Download report</button>
          )}
        </div>
      </div>
      {data.outcomeDisplay && <p className="rounded-lg border border-border bg-card p-4 text-sm font-medium">{data.outcomeDisplay}</p>}
      <p className="text-sm text-muted-foreground">
        Flow {data.flowRateResult ?? "—"} · pressure {data.pressureResult ?? "—"} · current draw {data.currentDrawResult ?? "—"} · electrical {data.electricalResult ?? "—"} · fitment {data.fitmentResult ?? "—"} · packaging {data.packagingResult ?? "—"}
      </p>
      {data.attempt.totals && (
        <p className="text-sm text-muted-foreground">
          Attempt {data.attempt.number}: {data.attempt.totals.criteria} criteria, {data.attempt.totals.passed} passed, {data.attempt.totals.failed} failed, {data.attempt.totals.engineeringReviewRequired} engineering review required.
          {data.overallResult ? ` Overall ${data.overallResult}.` : ""}
        </p>
      )}
      {data.ncrId && <p className="text-sm">Linked NCR #{data.ncrId}. NCR required: {data.ncrRequired}. Failure detected: {data.failureDetected}.</p>}
      {pending && (
        <section className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
          <h2 className="text-sm font-medium">{pending.label || "Waiting"}</h2>
          {pending.message && <p className="text-sm">{pending.message}</p>}
          {branch && (
            <div className="flex flex-col gap-3">
              {criteria.map((criterion) => {
                const draft = drafts[criterion.key] ?? draftFrom(criterion, undefined);
                const set = (patch: Partial<typeof draft>) => setDrafts({ ...drafts, [criterion.key]: { ...draft, ...patch } });
                return (
                  <div key={criterion.key} className="rounded-md border border-border bg-card p-3 text-sm">
                    <p className="font-medium">{criterion.label}</p>
                    <label className="mt-2 flex flex-col gap-1">
                      Result
                      <select className="rounded-md border border-border bg-background p-2" value={draft.result} onChange={(event) => set({ result: event.target.value })}>
                        <option value="Pass">Pass</option>
                        <option value="Fail">Fail</option>
                      </select>
                    </label>
                    {criterion.kind === "measurement" && (
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <input placeholder="Actual" className="rounded-md border border-border bg-background p-2" value={draft.actual} onChange={(event) => set({ actual: event.target.value })} />
                        <input placeholder="Units" className="rounded-md border border-border bg-background p-2" value={draft.units} onChange={(event) => set({ units: event.target.value })} />
                        <input placeholder="Specified limits from the approved drawing" className="rounded-md border border-border bg-background p-2 sm:col-span-2" value={draft.specifiedLimits} onChange={(event) => set({ specifiedLimits: event.target.value })} />
                      </div>
                    )}
                    <input placeholder="Photo file name" className="mt-2 w-full rounded-md border border-border bg-background p-2" value={draft.photo} onChange={(event) => set({ photo: event.target.value })} />
                    <textarea placeholder="Inspector comments" className="mt-2 min-h-16 w-full rounded-md border border-border bg-background p-2" value={draft.comments} onChange={(event) => set({ comments: event.target.value })} />
                    {draft.result === "Fail" && (
                      <label className="mt-2 flex items-center gap-2">
                        <input type="checkbox" checked={draft.critical} onChange={(event) => set({ critical: event.target.checked })} />
                        Critical failure
                      </label>
                    )}
                  </div>
                );
              })}
              <button type="button" disabled={saveResults.isPending} onClick={() => saveResults.mutate()} className="w-fit rounded-md border border-border px-3 py-2 text-sm">Save this branch</button>
            </div>
          )}
          {pending.pauseUntil === "correctionReady" && (
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.keys(correction).map((key) => (
                <input key={key} placeholder={key} className="rounded-md border border-border bg-background p-2 text-sm" value={correction[key as keyof typeof correction]} onChange={(event) => setCorrection({ ...correction, [key]: event.target.value })} />
              ))}
            </div>
          )}
          {pending.pauseUntil === "correctiveActionReady" && (
            <div className="grid gap-2 sm:grid-cols-2">
              {([
                ["rootCause", "Root cause"],
                ["correctiveAction", "Corrective action"],
                ["responsiblePerson", "Responsible person"],
                ["dueDate", "Due date"],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex flex-col gap-1 text-sm">
                  {label}
                  <input type={key === "dueDate" ? "date" : "text"} className="rounded-md border border-border bg-background p-2" value={action[key]} onChange={(event) => setAction({ ...action, [key]: event.target.value })} />
                </label>
              ))}
            </div>
          )}
          {pending.nodeId === "appr_eng" && (
            <label className="flex flex-col gap-1 text-sm">
              Specified limits for items in engineering review
              <input className="rounded-md border border-border bg-background p-2" value={limits} onChange={(event) => setLimits(event.target.value)} placeholder="From the approved drawing or specification" />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm">
            Comments
            <textarea className="min-h-16 rounded-md border border-border bg-background p-2" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <input placeholder="Rejected by" className="rounded-md border border-border bg-background p-2 text-sm" value={rejectedBy} onChange={(event) => setRejectedBy(event.target.value)} />
            <input type="date" className="rounded-md border border-border bg-background p-2 text-sm" value={rejectionDate} onChange={(event) => setRejectionDate(event.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            {(pending.routes ?? []).map((route) => (
              <button key={route.decision} type="button" disabled={decide.isPending || !data.workflowRunId} onClick={() => decide.mutate(route.decision)} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
                {route.label}
              </button>
            ))}
          </div>
        </section>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data.history.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium">Earlier attempts</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {data.history.map((attempt) => (
              <li key={attempt.number}>Attempt {attempt.number}: {attempt.overall ?? "recorded"} · {attempt.results.filter((row) => row.result === "Fail").length} failed</li>
            ))}
          </ul>
        </section>
      )}
      {data.correctiveAction && (
        <section className="text-sm">
          <h2 className="mb-1 font-medium">Corrective action</h2>
          <p>{data.correctiveAction.rootCause}</p>
          <p>{data.correctiveAction.correctiveAction}</p>
          <p className="text-muted-foreground">{data.correctiveAction.responsiblePerson} · due {data.correctiveAction.dueDate}</p>
        </section>
      )}
    </div>
  );
}
