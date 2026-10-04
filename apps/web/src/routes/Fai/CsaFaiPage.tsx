import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { criteriaForBranch, judgeCriterion, type CsaCriterion } from "../../../../../services/api/src/modules/csa-fai/csaFai.logic";
import { SignatureStamp, DEFAULT_CERTIFY } from "../../components/forms/SignatureStamp";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { uploadAttachmentFor } from "../../lib/attachments";
import { faiFill } from "../../lib/qualitySheetLogic";
import "../IsoForms/isoForm.css";

interface CsaListRow {
  id: number;
  number: string;
  partNumber: string;
  supplierName: string;
  status: string;
  stage: string;
  productionRelease: string;
  slaStatus: string | null;
  locked: string;
}

interface CsaRoute {
  decision: string;
  label: string;
  branch: string;
  commentsRequired?: boolean;
}

interface CsaResultRow {
  key: string;
  branch: string;
  label: string;
  result: string;
  actual: string | null;
  units: string | null;
  specifiedLimits: string | null;
  equipment: string | null;
  comments: string | null;
  photos: { fileName: string; caption?: string }[];
}

interface CsaRecord {
  id: number;
  number: string;
  partNumber: string;
  partDescription: string;
  supplierName: string;
  supplierPartNumber: string;
  sampleLotNumber: string;
  vehicleYear: string;
  vehicleMake: string;
  vehicleModel: string;
  position: string;
  inspectorName: string;
  status: string;
  stage: string;
  productFamily: string;
  productionRelease: string;
  approvedSupplier: string;
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
  attempt: { number: number; results: CsaResultRow[]; totals: { criteria: number; passed: number; failed: number; notApplicable: number; engineeringReviewRequired: number } | null; overall: string | null };
  history: { number: number; overall: string | null; results: CsaResultRow[] }[];
  correctiveAction: { failureCause: string; correctiveAction: string; owner: string; dueDate: string; correctedSampleId: string; completionEvidence: string } | null;
  dampingTestRequired?: boolean;
  vehicleFitmentPerformed?: boolean;
  limitOverrides?: Record<string, { specifiedLimits: string; units: string | null }>;
  signatureStamp?: string | null;
  pendingApproval?: {
    nodeId: string;
    label?: string;
    message?: string;
    branch?: "component" | "dimensional" | "functional" | "fitment";
    pauseUntil?: string;
    routes?: CsaRoute[];
  } | null;
}

const BLANK = {
  partNumber: "",
  partDescription: "",
  supplierName: "",
  supplierPartNumber: "",
  sampleLotNumber: "",
  vehicleYear: "",
  vehicleMake: "",
  vehicleModel: "",
  position: "",
  inspectorName: "",
  dateOpened: new Date().toISOString().slice(0, 10),
  dampingTestRequired: false,
  vehicleFitmentPerformed: false,
};

async function downloadCsaPdf(id: number, number: string) {
  const response = await apiClient.get(`/fai/csa/${id}/pdf`, { responseType: "blob" });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${number}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}

export function CsaFaiListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["csa-fai"], queryFn: async () => (await apiClient.get<CsaListRow[]>("/fai/csa")).data });
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState<string | null>(null);
  const submit = useMutation({
    mutationFn: async () => (await apiClient.post<CsaRecord>("/fai/csa", form)).data,
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["csa-fai"] });
      navigate(`/fai/csa/${created.id}`);
    },
    onError: (err) => setError(extractErrorMessage(err, "The CSA first article could not be submitted.")),
  });
  const fields: [keyof typeof BLANK, string][] = [
    ["partNumber", "Part number"],
    ["partDescription", "Part description"],
    ["supplierName", "Supplier"],
    ["supplierPartNumber", "Supplier part number"],
    ["sampleLotNumber", "Sample lot number"],
    ["vehicleYear", "Vehicle year"],
    ["vehicleMake", "Make"],
    ["vehicleModel", "Model"],
    ["position", "Position"],
    ["inspectorName", "Inspector"],
    ["dateOpened", "Date opened"],
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">CSA First Article Inspection</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">Complete Strut Assembly inspection for aftermarket parts. The workflow stays a draft until it is published. A failed assembly cannot be released to production.</p>
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
        <h2 className="sm:col-span-2 text-sm font-medium">Submit a CSA FAI</h2>
        {fields.map(([key, label]) => (
          <label key={key} className="flex flex-col gap-1 text-sm">
            <span>{label}</span>
            <input
              required
              type={key === "dateOpened" ? "date" : "text"}
              className="rounded-md border border-border bg-background p-2"
              value={String(form[key])}
              onChange={(event) => setForm({ ...form, [key]: event.target.value })}
            />
          </label>
        ))}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.dampingTestRequired} onChange={(event) => setForm({ ...form, dampingTestRequired: event.target.checked })} />
          Damping test required
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.vehicleFitmentPerformed} onChange={(event) => setForm({ ...form, vehicleFitmentPerformed: event.target.checked })} />
          Vehicle fitment performed
        </label>
        {error && <p className="sm:col-span-2 text-sm text-destructive">{error}</p>}
        <button type="submit" disabled={submit.isPending} className="sm:col-span-2 w-fit rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
          Submit CSA FAI
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
              <td className="py-2"><Link to={`/fai/csa/${row.id}`} className="text-primary hover:underline">{row.number}</Link></td>
              <td>{row.partNumber}</td>
              <td>{row.supplierName}</td>
              <td><StatusBadge value={row.status} /></td>
              <td>{row.stage}</td>
              <td>{row.productionRelease}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.data?.length === 0 && <p className="text-sm text-muted-foreground">No CSA first articles yet.</p>}
    </div>
  );
}

function draftFrom(criterion: CsaCriterion, existing: CsaResultRow | undefined) {
  return {
    result: existing?.result ?? (criterion.kind === "evidence" ? "" : "Pass"),
    actual: existing?.actual ?? "",
    units: existing?.units ?? "",
    specifiedLimits: existing?.specifiedLimits ?? "",
    equipment: existing?.equipment ?? "",
    comments: existing?.comments ?? "",
    photo: existing?.photos[0]?.fileName ?? "",
  };
}

export function CsaFaiRecordPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const record = useQuery({
    queryKey: ["csa-fai", id],
    queryFn: async () => (await apiClient.get<CsaRecord>(`/fai/csa/${id}`)).data,
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
  const [correction, setCorrection] = useState({ partNumber: "", partDescription: "", supplierName: "", supplierPartNumber: "", sampleLotNumber: "", vehicleYear: "", vehicleMake: "", vehicleModel: "", position: "", inspectorName: "" });
  const [action, setAction] = useState({ failureCause: "", correctiveAction: "", owner: "", dueDate: "", correctedSampleId: "", completionEvidence: "" });
  const [error, setError] = useState<string | null>(null);

  if (data && loadedFor !== `${data.id}:${data.attemptNumber}:${branch ?? ""}`) {
    const next: Record<string, ReturnType<typeof draftFrom>> = {};
    for (const criterion of criteria) next[criterion.key] = draftFrom(criterion, data.attempt.results.find((row) => row.key === criterion.key));
    setDrafts(next);
    setLoadedFor(`${data.id}:${data.attemptNumber}:${branch ?? ""}`);
  }

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["csa-fai", id] });
    await queryClient.invalidateQueries({ queryKey: ["csa-fai"] });
  };
  const saveResults = useMutation({
    mutationFn: async () => {
      const entries = criteria.map((criterion) => {
        const draft = drafts[criterion.key];
        return {
          key: criterion.key,
          result: criterion.kind === "evidence" ? undefined : draft?.result,
          actual: draft?.actual || null,
          units: draft?.units || null,
          specifiedLimits: draft?.specifiedLimits || null,
          equipment: draft?.equipment || null,
          comments: draft?.comments || null,
          photos: draft?.photo ? [{ fileName: draft.photo }] : [],
        };
      });
      return (await apiClient.put(`/fai/csa/${id}/results`, { branch, entries })).data;
    },
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError: (err) => setError(extractErrorMessage(err, "The inspection results could not be saved.")),
  });
  const decide = useMutation({
    mutationFn: async ({ decision, pin }: { decision: string; pin: string }) => {
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
      return (await apiClient.post(`/workflow/runs/${data?.workflowRunId}/decision`, { decision, notes: notes || undefined, details, pin, certified: true })).data;
    },
    onSuccess: async () => {
      setError(null);
      setNotes("");
      await refresh();
    },
    onError: (err) => setError(extractErrorMessage(err, "That decision could not be recorded.")),
  });

  if (record.isLoading) return <p className="text-sm text-muted-foreground">Loading CSA first article…</p>;
  if (!data) return <p className="text-sm text-destructive">This CSA first article could not be opened.</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground"><Link to="/fai/csa" className="text-primary hover:underline">CSA first articles</Link></p>
          <h1 className="text-2xl font-semibold">{data.number}</h1>
          <p className="text-sm">{data.partNumber} — {data.partDescription}</p>
          <p className="text-sm text-muted-foreground">{data.supplierName} · {data.vehicleYear} {data.vehicleMake} {data.vehicleModel} {data.position} · {data.productFamily}</p>
        </div>
        <div className="flex flex-col items-end gap-2 text-sm">
          <StatusBadge value={data.status} />
          <span>Stage: {data.stage}</span>
          <span>Production release: {data.productionRelease}</span>
          <span>Approved supplier: {data.approvedSupplier}</span>
          {data.slaStatus && <span>SLA: {data.slaStatus}</span>}
          {(data.status === "Approved" || data.status === "Closed") && (
            <button type="button" className="rounded-md border border-border px-3 py-1.5" onClick={() => void downloadCsaPdf(data.id, data.number)}>Download report</button>
          )}
        </div>
      </div>
      {data.outcomeDisplay && <p className="rounded-lg border border-border bg-card p-4 text-sm font-medium">{data.outcomeDisplay}</p>}
      {data.attempt.totals && (
        <p className="text-sm text-muted-foreground">
          Attempt {data.attempt.number}: {data.attempt.totals.criteria} criteria, {data.attempt.totals.passed} passed, {data.attempt.totals.failed} failed, {data.attempt.totals.notApplicable} not applicable, {data.attempt.totals.engineeringReviewRequired} engineering review required.
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
              <div className="iso-wrap">
                <table className="iso" data-testid="csa-fai-grid" aria-label="CSA inspection criteria">
                  <thead>
                    <tr>
                      {["Characteristic", "Result", "Actual", "Units", "Limits", "Equipment", "Comments", "Photo"].map((heading) => (
                        <th key={heading} className="header">{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {criteria.map((criterion) => {
                      const draft = drafts[criterion.key] ?? draftFrom(criterion, undefined);
                      const set = (patch: Partial<typeof draft>) => setDrafts({ ...drafts, [criterion.key]: { ...draft, ...patch } });
                      const measured = criterion.kind === "measurement" && !(criterion.qualitativeUnlessMeasured && !draft.actual && !draft.specifiedLimits);
                      const outcome = measured
                        ? judgeCriterion(criterion, { actual: draft.actual || null, units: draft.units || null, specifiedLimits: draft.specifiedLimits || null, equipment: draft.equipment || null, comments: draft.comments || null, photos: draft.photo ? [{ fileName: draft.photo }] : [] }, { dampingTestRequired: data?.dampingTestRequired === true, vehicleFitmentPerformed: data?.vehicleFitmentPerformed === true, limitOverrides: data?.limitOverrides ?? {} })
                        : null;
                      const result = outcome ? outcome.result : draft.result;
                      return (
                        <tr key={criterion.key}>
                          <td className="left">{criterion.label}</td>
                          <td className={faiFill(result)}>{measured ? result : criterion.kind === "evidence" ? "Photo" : (
                            <select className="iso-in" aria-label={`Result for ${criterion.label}`} value={draft.result} onChange={(event) => set({ result: event.target.value })}>
                              <option value="Pass">Pass</option>
                              <option value="Fail">Fail</option>
                              {(criterion.allowNa || criterion.when) && <option value="Not Applicable">Not Applicable</option>}
                            </select>
                          )}</td>
                          <td>{criterion.kind === "measurement" ? <input className="iso-in" aria-label={`Actual for ${criterion.label}`} value={draft.actual} onChange={(event) => set({ actual: event.target.value })} /> : ""}</td>
                          <td>{criterion.kind === "measurement" ? <input className="iso-in" aria-label={`Units for ${criterion.label}`} value={draft.units} onChange={(event) => set({ units: event.target.value })} /> : ""}</td>
                          <td>{criterion.kind === "measurement" ? <input className="iso-in" aria-label={`Limits for ${criterion.label}`} placeholder="From the drawing" value={draft.specifiedLimits} onChange={(event) => set({ specifiedLimits: event.target.value })} /> : ""}</td>
                          <td>{criterion.kind === "measurement" ? <input className="iso-in" aria-label={`Equipment for ${criterion.label}`} value={draft.equipment} onChange={(event) => set({ equipment: event.target.value })} /> : ""}</td>
                          <td><input className="iso-in" aria-label={`Comments for ${criterion.label}`} value={draft.comments} onChange={(event) => set({ comments: event.target.value })} /></td>
                          <td>
                            <input className="iso-in" aria-label={`Photo for ${criterion.label}`} type="file" onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (!file || !data) return;
                              void uploadAttachmentFor("csa_fai", data.id, file).then((uploaded) => {
                                const name = typeof uploaded === "object" && uploaded && "fileName" in uploaded && typeof uploaded.fileName === "string" ? uploaded.fileName : file.name;
                                set({ photo: name });
                              }).catch((err) => setError(extractErrorMessage(err, "Couldn't upload that photo.")));
                            }} />
                            {draft.photo ? <span className="block text-xs">{draft.photo}</span> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
                ["failureCause", "Failure cause"],
                ["correctiveAction", "Corrective action"],
                ["owner", "Owner"],
                ["dueDate", "Due date"],
                ["correctedSampleId", "Corrected sample id"],
                ["completionEvidence", "Completion evidence"],
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
          <div className="grid gap-3 md:grid-cols-2">
            {(pending.routes ?? []).map((route) => (
              <div key={route.decision} className="rounded-md border border-border bg-card p-3">
                <p className="mb-1 text-xs font-semibold">{route.label}</p>
                <SignatureStamp
                  value={null}
                  certify={DEFAULT_CERTIFY}
                  variant="sheet"
                  disabled={decide.isPending || !data.workflowRunId}
                  onSign={async (pin) => { await decide.mutateAsync({ decision: route.decision, pin }); }}
                />
              </div>
            ))}
          </div>
          {data.signatureStamp && <p className="text-sm">Signed: {data.signatureStamp}</p>}
        </section>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <WorkflowHistoryPanel moduleName="csa_fai" recordId={Number.isInteger(Number(id)) ? Number(id) : undefined} />
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
          <p>{data.correctiveAction.correctiveAction}</p>
          <p className="text-muted-foreground">Owner {data.correctiveAction.owner} · due {data.correctiveAction.dueDate} · sample {data.correctiveAction.correctedSampleId}</p>
        </section>
      )}
    </div>
  );
}
