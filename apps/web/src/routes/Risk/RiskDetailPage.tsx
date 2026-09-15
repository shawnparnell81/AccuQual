import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import { useCurrentUser } from "../../hooks/useAuth";
import { useWorkflowAction, extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useCanEditWorkflow } from "../../hooks/useWorkflowAccess";
import { useToast } from "../../components/shared/ToastProvider";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { TextField, TextAreaField, SelectField } from "../../components/forms/Field";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { Modal } from "../../components/modals/Modal";
import { RISK_CATEGORIES } from "../../components/shared/riskConstants";
import { CreateCustomerButton } from "../../components/shared/CreateCustomerButton";
import type { RiskAssessment, RiskMitigation, FmeaItem } from "../../api/types";

const riskHooks = createResourceHooks<RiskAssessment>("risk");
const RATINGS_5 = [1, 2, 3, 4, 5];
const RATINGS_10 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const SOURCE_LINK: Record<string, (id: number) => string> = {
  NCR: (id) => `/ncr/${id}`,
  Supplier: (id) => `/suppliers/${id}`,
  WorkOrder: (id) => `/work-orders/${id}`,
  Customer: (id) => `/customers/${id}`,
};

/**
 * Risk / FMEA detail — the Risk Register record (edit, workflow transitions,
 * AI analysis, mitigation plan) plus the pre-existing FMEA quick-entry table
 * and full FMEA document, unchanged. Full CRUD + workflow + department
 * gating + audit trail all confirmed real end-to-end (see the Risk
 * Management module review) — this page is what makes that reachable.
 */
export function RiskDetailPage() {
  const { id } = useParams();
  const riskId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();
  const currentUser = useCurrentUser();
  const canEdit = useCanEditWorkflow("risk");
  const isAdmin = currentUser?.roleName === "admin" || currentUser?.roleName === "platform_admin";

  const { data: risk, isLoading } = riskHooks.useOne(riskId);
  const historyKey: unknown[][] = [["workflow-history", "risk", riskId]];

  const startMitigation = useWorkflowAction("risk", "start-mitigation", { successMessage: "Moved to mitigation.", invalidateKeys: historyKey });
  const startMonitoring = useWorkflowAction("risk", "start-monitoring", { successMessage: "Moved to monitoring.", invalidateKeys: historyKey });
  const closeRisk = useWorkflowAction("risk", "close", { successMessage: "Risk closed.", invalidateKeys: historyKey });

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  const deleteRisk = useMutation({
    mutationFn: async () => apiClient.delete(`/risk/${riskId}`),
    onSuccess: () => {
      toast.success("Risk deleted.");
      navigate("/risk");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't delete this risk.")),
  });

  if (isLoading || !risk) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const sourceLink = risk.sourceType && risk.sourceId ? SOURCE_LINK[risk.sourceType]?.(risk.sourceId) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{risk.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {risk.riskLevel && <StatusBadge value={risk.riskLevel} />}
            <StatusBadge value={risk.status} />
            {risk.category && <span className="text-sm text-muted-foreground">{risk.category}</span>}
            {risk.department && <span className="text-sm text-muted-foreground">· {risk.department}</span>}
            {sourceLink && (
              <a href={sourceLink} className="text-sm text-primary hover:underline">
                Linked {risk.sourceType} #{risk.sourceId}
              </a>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <OpenFormButton formType="fmea" entityId={risk.id} title={`FMEA #${risk.id} Document`} label="FMEA Document" />
          <button onClick={() => setAiOpen(true)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            AI Risk Analysis
          </button>
          <CreateCustomerButton sourceType="Risk" sourceId={risk.id} defaultLegalName={risk.title} />
          {canEdit && (
            <button onClick={() => setEditOpen(true)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              Edit
            </button>
          )}
          <WorkflowActionButton label="Start Mitigation" navKey="risk" action={startMitigation} onClick={() => startMitigation.mutate({ id: riskId })} visible={risk.status === "open"} />
          <WorkflowActionButton label="Start Monitoring" navKey="risk" action={startMonitoring} onClick={() => startMonitoring.mutate({ id: riskId })} visible={risk.status === "mitigation"} />
          <WorkflowActionButton label="Close" navKey="risk" action={closeRisk} onClick={() => closeRisk.mutate({ id: riskId })} visible={risk.status === "monitoring"} variant="primary" />
          {isAdmin && (
            <button onClick={() => setDeleteOpen(true)} className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive hover:bg-destructive/10">
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm">{risk.description || "No description provided."}</p>
        <div className="mt-3 flex gap-6 text-sm text-muted-foreground">
          <span>Severity: <b className="text-foreground">{risk.severity ?? "—"}</b></span>
          <span>Probability: <b className="text-foreground">{risk.probability ?? "—"}</b></span>
          <span>Risk score: <b className="text-foreground">{risk.riskScore ?? "—"}</b></span>
        </div>
      </div>

      <MitigationPanel riskId={riskId} mitigations={risk.mitigations ?? []} canPropose={canEdit} />

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">Failure Modes (FMEA quick entry)</h2>
        <FmeaTable riskId={riskId} items={risk.fmeaItems ?? []} />
      </div>

      <WorkflowHistoryPanel moduleName="risk" recordId={riskId} />

      <EditRiskModal risk={risk} isOpen={editOpen} onClose={() => setEditOpen(false)} />
      <AiAnalysisModal riskId={riskId} isOpen={aiOpen} onClose={() => setAiOpen(false)} />

      <Modal title="Delete Risk" isOpen={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <div className="flex flex-col gap-4">
          <p className="text-sm">Permanently delete "{risk.title}" and its mitigation actions and FMEA line items? This cannot be undone.</p>
          <div className="flex gap-2">
            <button
              onClick={() => deleteRisk.mutate()}
              disabled={deleteRisk.isPending}
              className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-60"
            >
              {deleteRisk.isPending ? "Deleting…" : "Delete permanently"}
            </button>
            <button onClick={() => setDeleteOpen(false)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function EditRiskModal({ risk, isOpen, onClose }: { risk: RiskAssessment; isOpen: boolean; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    title: risk.title,
    description: risk.description ?? "",
    category: risk.category ?? "process",
    severity: risk.severity ? String(risk.severity) : "",
    probability: risk.probability ? String(risk.probability) : "",
    processArea: risk.processArea ?? "",
    department: risk.department ?? "",
  });

  const update = useMutation({
    mutationFn: async () =>
      (
        await apiClient.put(`/risk/${risk.id}`, {
          title: form.title,
          description: form.description || undefined,
          category: form.category,
          severity: form.severity ? Number(form.severity) : undefined,
          probability: form.probability ? Number(form.probability) : undefined,
          processArea: form.processArea || undefined,
          department: form.department || undefined,
        })
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["risk", risk.id] });
      toast.success("Risk updated.");
      onClose();
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't update this risk — Quality/Engineering only.")),
  });

  return (
    <Modal title={`Edit Risk #${risk.id}`} isOpen={isOpen} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate();
        }}
      >
        <TextField label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        <TextAreaField label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <SelectField label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          {RISK_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </SelectField>
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Severity (1-5)" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
            <option value="">—</option>
            {RATINGS_5.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </SelectField>
          <SelectField label="Probability (1-5)" value={form.probability} onChange={(e) => setForm({ ...form, probability: e.target.value })}>
            <option value="">—</option>
            {RATINGS_5.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </SelectField>
        </div>
        <TextField label="Process area" value={form.processArea} onChange={(e) => setForm({ ...form, processArea: e.target.value })} />
        <TextField label="Owning department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
        <button type="submit" disabled={update.isPending} className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {update.isPending ? "Saving…" : "Save"}
        </button>
      </form>
    </Modal>
  );
}

interface RiskAnalysisResult {
  severity?: number;
  probability?: number;
  rationale?: string;
  mitigationActions?: { action: string; suggestedDepartment: string }[];
  monitoringPlan?: string;
  suggestionId: number;
}

function AiAnalysisModal({ riskId, isOpen, onClose }: { riskId: number; isOpen: boolean; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<RiskAnalysisResult | null>(null);

  const analyze = useMutation({
    mutationFn: async () => (await apiClient.post<RiskAnalysisResult>(`/risk/${riskId}/ai-analysis`)).data,
    onSuccess: (data) => setResult(data),
    onError: (err) => toast.error(extractErrorMessage(err, "The AI analysis couldn't run.")),
  });

  const applyScoring = useMutation({
    mutationFn: async () =>
      apiClient.put(`/risk/${riskId}`, { severity: result?.severity, probability: result?.probability, aiSuggestionId: result?.suggestionId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["risk", riskId] });
      toast.success("Severity/probability applied from the AI suggestion.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't apply the suggestion.")),
  });

  const addSuggestedMitigation = useMutation({
    mutationFn: async (action: string) => apiClient.post(`/risk/${riskId}/mitigation`, { action, aiSuggestionId: result?.suggestionId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["risk", riskId] });
      toast.success("Mitigation action added.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't add that mitigation action.")),
  });

  return (
    <Modal title="AI Risk Analysis" isOpen={isOpen} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          Suggests severity, probability, mitigation actions, and a monitoring plan from this risk's own description and linked source record. Nothing is
          saved until you confirm each item below.
        </p>
        {!result && (
          <button onClick={() => analyze.mutate()} disabled={analyze.isPending} className="w-fit rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
            {analyze.isPending ? "Analyzing…" : "Run AI analysis"}
          </button>
        )}
        {result && (
          <div className="flex flex-col gap-4 rounded-md border border-border bg-muted/40 p-3">
            {(result.severity || result.probability) && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm">
                  Suggested severity <b>{result.severity ?? "—"}</b>, probability <b>{result.probability ?? "—"}</b>
                </p>
                <button
                  onClick={() => applyScoring.mutate()}
                  disabled={applyScoring.isPending}
                  className="rounded-md bg-button px-3 py-1.5 text-xs font-medium text-button-foreground disabled:opacity-60"
                >
                  Apply
                </button>
              </div>
            )}
            {result.rationale && <p className="text-xs text-muted-foreground">{result.rationale}</p>}
            {result.mitigationActions && result.mitigationActions.length > 0 && (
              <div>
                <h4 className="mb-1 text-xs font-medium text-muted-foreground">Suggested mitigation actions</h4>
                <ul className="flex flex-col gap-2">
                  {result.mitigationActions.map((m, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 text-sm">
                      <span>
                        {m.action} <span className="text-xs text-muted-foreground">({m.suggestedDepartment})</span>
                      </span>
                      <button
                        onClick={() => addSuggestedMitigation.mutate(m.action)}
                        disabled={addSuggestedMitigation.isPending}
                        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                      >
                        Add
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.monitoringPlan && (
              <div>
                <h4 className="mb-1 text-xs font-medium text-muted-foreground">Monitoring plan</h4>
                <p className="text-sm">{result.monitoringPlan}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function MitigationPanel({ riskId, mitigations, canPropose }: { riskId: number; mitigations: RiskMitigation[]; canPropose: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [action, setAction] = useState("");

  const create = useMutation({
    mutationFn: async () => apiClient.post(`/risk/${riskId}/mitigation`, { action }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["risk", riskId] });
      setAction("");
      toast.success("Mitigation action added.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't add that mitigation action.")),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => apiClient.put(`/risk/${riskId}/mitigation/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["risk", riskId] }),
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't update that mitigation action.")),
  });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-medium">Mitigation Plan</h2>
      {mitigations.length === 0 && <p className="text-sm text-muted-foreground">No mitigation actions yet.</p>}
      <ul className="flex flex-col gap-2">
        {mitigations.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 border-b border-border pb-2 text-sm last:border-0">
            <div>
              <p>{m.action}</p>
              {m.dueDate && <p className="text-xs text-muted-foreground">Due {new Date(m.dueDate).toLocaleDateString()}</p>}
            </div>
            <select
              value={m.status}
              onChange={(e) => updateStatus.mutate({ id: m.id, status: e.target.value })}
              disabled={!canPropose}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
            >
              <option value="planned">planned</option>
              <option value="in_progress">in_progress</option>
              <option value="completed">completed</option>
            </select>
          </li>
        ))}
      </ul>
      {canPropose && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (action.trim()) create.mutate();
          }}
        >
          <input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="Propose a mitigation action…"
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button type="submit" disabled={create.isPending} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60">
            Add
          </button>
        </form>
      )}
    </div>
  );
}

function FmeaTable({ riskId, items }: { riskId: number; items: FmeaItem[] }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const emptyItem = { failureMode: "", effect: "", cause: "", severity: 1, occurrence: 1, detection: 1, recommendedAction: "" };
  const [item, setItem] = useState(emptyItem);

  const addItem = useMutation({
    mutationFn: async () => apiClient.post(`/risk/${riskId}/fmea`, item),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["risk", riskId] });
      setItem(emptyItem);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't add that failure mode.")),
  });

  return (
    <>
      <div className="mb-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-2 pr-3">Failure Mode</th>
              <th className="pb-2 pr-3">Effect</th>
              <th className="pb-2 pr-3">Cause</th>
              <th className="pb-2 pr-3">S</th>
              <th className="pb-2 pr-3">O</th>
              <th className="pb-2 pr-3">D</th>
              <th className="pb-2 pr-3">RPN</th>
              <th className="pb-2">Recommended Action</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={8} className="py-3 text-muted-foreground">
                  No failure modes logged yet.
                </td>
              </tr>
            )}
            {items.map((i) => (
              <tr key={i.id} className="border-t border-border">
                <td className="py-2 pr-3">{i.failureMode}</td>
                <td className="py-2 pr-3">{i.effect ?? "—"}</td>
                <td className="py-2 pr-3">{i.cause ?? "—"}</td>
                <td className="py-2 pr-3">{i.severity}</td>
                <td className="py-2 pr-3">{i.occurrence}</td>
                <td className="py-2 pr-3">{i.detection}</td>
                <td className="py-2 pr-3 font-semibold">{i.rpn}</td>
                <td className="py-2">{i.recommendedAction ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form
        className="grid gap-3 md:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          addItem.mutate();
        }}
      >
        <TextField label="Failure Mode" value={item.failureMode} onChange={(e) => setItem({ ...item, failureMode: e.target.value })} required />
        <TextField label="Effect" value={item.effect} onChange={(e) => setItem({ ...item, effect: e.target.value })} />
        <TextField label="Cause" value={item.cause} onChange={(e) => setItem({ ...item, cause: e.target.value })} />
        <TextField label="Recommended Action" value={item.recommendedAction} onChange={(e) => setItem({ ...item, recommendedAction: e.target.value })} />
        <SelectField label="Severity" value={String(item.severity)} onChange={(e) => setItem({ ...item, severity: Number(e.target.value) })}>
          {RATINGS_10.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </SelectField>
        <SelectField label="Occurrence" value={String(item.occurrence)} onChange={(e) => setItem({ ...item, occurrence: Number(e.target.value) })}>
          {RATINGS_10.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </SelectField>
        <SelectField label="Detection" value={String(item.detection)} onChange={(e) => setItem({ ...item, detection: Number(e.target.value) })}>
          {RATINGS_10.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </SelectField>
        <button type="submit" disabled={addItem.isPending} className="w-fit self-end rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
          Add failure mode
        </button>
      </form>
    </>
  );
}
