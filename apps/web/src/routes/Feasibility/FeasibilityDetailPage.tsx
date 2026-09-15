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
import { Modal } from "../../components/modals/Modal";
import { FEASIBILITY_DIMENSION_KEYS } from "../../components/shared/feasibilityConstants";
import { CreateCustomerButton } from "../../components/shared/CreateCustomerButton";
import type { FeasibilityReview, FeasibilityScore } from "../../api/types";

const feasibilityHooks = createResourceHooks<FeasibilityReview>("feasibility");

const SOURCE_LINK: Record<string, (id: number) => string> = {
  ncr: (id) => `/ncr/${id}`,
  supplier: (id) => `/suppliers/${id}`,
  complaint: (id) => `/complaints/${id}`,
  ppap: (id) => `/ppap/${id}`,
  change_request: (id) => `/change/${id}`,
  work_order: (id) => `/work-orders/${id}`,
  requisition: (id) => `/erp/requisitions/${id}`,
  po: (id) => `/erp/purchase-orders/${id}`,
  rma: (id) => `/rma/${id}`,
  customer: (id) => `/customers/${id}`,
};

const NEXT_ACTION: Record<string, { action: string; label: string }> = {
  draft: { action: "submit", label: "Submit" },
  submitted: { action: "review", label: "Move to Under Review" },
};

/**
 * Feasibility Review detail — the unified module's own record page: edit,
 * workflow transitions (draft -> submitted -> under_review -> approved |
 * rejected), the generic scores panel (drives overallScore/decision
 * automatically), AI analysis routed through the shared POST /ai/assistant
 * (not a dedicated pipeline — see feasibility.routes.ts's own comment), and
 * delete. Full CRUD + workflow + department gating + audit trail all real
 * end-to-end (see the module review).
 */
export function FeasibilityDetailPage() {
  const { id } = useParams();
  const feasibilityId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();
  const currentUser = useCurrentUser();
  const canEdit = useCanEditWorkflow("feasibility");
  const canDelete = currentUser?.roleName === "admin" || currentUser?.roleName === "platform_admin" || currentUser?.department === "quality";

  const { data: review, isLoading } = feasibilityHooks.useOne(feasibilityId);
  const historyKey: unknown[][] = [["workflow-history", "feasibility", feasibilityId]];

  const submitAction = useWorkflowAction("feasibility", "submit", { successMessage: "Submitted.", invalidateKeys: historyKey });
  const reviewAction = useWorkflowAction("feasibility", "review", { successMessage: "Moved to under review.", invalidateKeys: historyKey });
  const approveAction = useWorkflowAction("feasibility", "approve", { successMessage: "Approved.", invalidateKeys: historyKey });
  const rejectAction = useWorkflowAction("feasibility", "reject", { successMessage: "Rejected.", invalidateKeys: historyKey });

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  const deleteReview = useMutation({
    mutationFn: async () => apiClient.delete(`/feasibility/${feasibilityId}`),
    onSuccess: () => {
      toast.success("Feasibility review deleted.");
      navigate("/feasibility");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't delete this review.")),
  });

  if (isLoading || !review) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const sourceLink = review.sourceType && review.sourceId ? SOURCE_LINK[review.sourceType]?.(review.sourceId) : undefined;
  const next = NEXT_ACTION[review.status];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{review.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {review.decision && <StatusBadge value={review.decision} />}
            <StatusBadge value={review.status} />
            {review.department && <span className="text-sm text-muted-foreground">{review.department}</span>}
            {sourceLink && (
              <a href={sourceLink} className="text-sm text-primary hover:underline">
                Linked {review.sourceType?.replace(/_/g, " ")} #{review.sourceId}
              </a>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setAiOpen(true)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            AI Feasibility Analysis
          </button>
          <CreateCustomerButton sourceType="Feasibility" sourceId={feasibilityId} defaultLegalName={review.title} />
          {canEdit && (
            <button onClick={() => setEditOpen(true)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              Edit
            </button>
          )}
          {next && (
            <WorkflowActionButton
              label={next.label}
              navKey="feasibility"
              action={next.action === "submit" ? submitAction : reviewAction}
              onClick={() => (next.action === "submit" ? submitAction : reviewAction).mutate({ id: feasibilityId })}
              variant="primary"
            />
          )}
          <WorkflowActionButton label="Approve" navKey="feasibility" action={approveAction} onClick={() => approveAction.mutate({ id: feasibilityId })} visible={review.status === "under_review"} variant="primary" />
          <WorkflowActionButton label="Reject" navKey="feasibility" action={rejectAction} onClick={() => rejectAction.mutate({ id: feasibilityId })} visible={review.status === "under_review"} />
          {canDelete && (
            <button onClick={() => setDeleteOpen(true)} className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive hover:bg-destructive/10">
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm">{review.description || "No description provided."}</p>
        <div className="mt-3 flex gap-6 text-sm text-muted-foreground">
          <span>
            Overall score: <b className="text-foreground">{review.overallScore ?? "—"}</b>
          </span>
          <span>
            Decision: <b className="text-foreground">{review.decision ?? "not yet calculated"}</b> (feasible ≥ 3.5, conditional ≥ 2.5, else not feasible)
          </span>
        </div>
      </div>

      <ScoresPanel feasibilityId={feasibilityId} scores={review.scores ?? []} canPropose={true} />

      <WorkflowHistoryPanel moduleName="feasibility" recordId={feasibilityId} />

      <EditFeasibilityModal review={review} isOpen={editOpen} onClose={() => setEditOpen(false)} />
      <FeasibilityAiModal feasibilityId={feasibilityId} isOpen={aiOpen} onClose={() => setAiOpen(false)} />

      <Modal title="Delete Feasibility Review" isOpen={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <div className="flex flex-col gap-4">
          <p className="text-sm">Permanently delete "{review.title}" and its scores? This cannot be undone.</p>
          <div className="flex gap-2">
            <button
              onClick={() => deleteReview.mutate()}
              disabled={deleteReview.isPending}
              className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-60"
            >
              {deleteReview.isPending ? "Deleting…" : "Delete permanently"}
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

function EditFeasibilityModal({ review, isOpen, onClose }: { review: FeasibilityReview; isOpen: boolean; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ title: review.title, description: review.description ?? "", department: review.department ?? "" });

  const update = useMutation({
    mutationFn: async () => (await apiClient.put(`/feasibility/${review.id}`, { title: form.title, description: form.description || undefined, department: form.department || undefined })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feasibility", review.id] });
      toast.success("Feasibility review updated.");
      onClose();
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't update this review — Quality/Engineering only.")),
  });

  return (
    <Modal title={`Edit Feasibility Review #${review.id}`} isOpen={isOpen} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate();
        }}
      >
        <TextField label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        <TextAreaField label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <TextField label="Owning department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
        <button type="submit" disabled={update.isPending} className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {update.isPending ? "Saving…" : "Save"}
        </button>
      </form>
    </Modal>
  );
}

function ScoresPanel({ feasibilityId, scores, canPropose }: { feasibilityId: number; scores: FeasibilityScore[]; canPropose: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [dimensionKey, setDimensionKey] = useState<string>(FEASIBILITY_DIMENSION_KEYS[0]);
  const [value, setValue] = useState("3");
  const [weight, setWeight] = useState("");

  const addScore = useMutation({
    mutationFn: async () =>
      apiClient.post(`/feasibility/${feasibilityId}/scores`, { dimensionKey, dimensionLabel: dimensionKey, value: Number(value), weight: weight ? Number(weight) : undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feasibility", feasibilityId] });
      toast.success("Score added.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't add that score.")),
  });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-medium">Scoring Dimensions</h2>
      {scores.length === 0 && <p className="text-sm text-muted-foreground">No scores yet — overall score and decision will calculate once at least one is added.</p>}
      {scores.length > 0 && (
        <table className="mb-4 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-2 pr-3">Dimension</th>
              <th className="pb-2 pr-3">Value (1-5)</th>
              <th className="pb-2 pr-3">Weight</th>
              <th className="pb-2">Contribution</th>
            </tr>
          </thead>
          <tbody>
            {scores.map((s) => (
              <tr key={s.id} className="border-t border-border">
                <td className="py-1.5 pr-3">{s.dimensionLabel ?? s.dimensionKey}</td>
                <td className="py-1.5 pr-3">{s.value}</td>
                <td className="py-1.5 pr-3">{s.weight ?? "—"}</td>
                <td className="py-1.5">{s.contribution ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canPropose && (
        <form
          className="grid gap-3 md:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            addScore.mutate();
          }}
        >
          <SelectField label="Dimension" value={dimensionKey} onChange={(e) => setDimensionKey(e.target.value)}>
            {FEASIBILITY_DIMENSION_KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </SelectField>
          <SelectField label="Value (1-5)" value={value} onChange={(e) => setValue(e.target.value)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </SelectField>
          <TextField label="Weight (optional)" type="number" step="any" value={weight} onChange={(e) => setWeight(e.target.value)} />
          <button type="submit" disabled={addScore.isPending} className="self-end rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60">
            Add score
          </button>
        </form>
      )}
    </div>
  );
}

interface ParsedSuggestion {
  scores?: { dimensionKey: string; dimensionLabel?: string; value: number }[];
  justification?: string;
  decision?: string;
}

/**
 * AI Feasibility Analysis — routed through the shared POST /ai/assistant
 * (context.module = "feasibility"), not a dedicated pipeline, per the
 * module's own locked decision. /ai/assistant returns freeform text, not a
 * guaranteed shape, so this attempts to parse it as the JSON the prompt
 * asks for and falls back to showing the raw text if that fails.
 */
function FeasibilityAiModal({ feasibilityId, isOpen, onClose }: { feasibilityId: number; isOpen: boolean; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState(
    "Suggest feasibility scores (1-5) for the dimensions most relevant to this record's linked source, a brief justification, and any next-step notes. " +
      'Respond as strict JSON only: { "scores": [{ "dimensionKey": string, "dimensionLabel": string, "value": number }], "justification": string }'
  );
  const [raw, setRaw] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedSuggestion | null>(null);

  const generate = useMutation({
    mutationFn: async () =>
      (await apiClient.post("/ai/assistant", { messages: [{ role: "user", content: prompt }], context: { module: "feasibility", recordId: feasibilityId } })).data as { content: string },
    onSuccess: (data) => {
      setRaw(data.content);
      try {
        setParsed(JSON.parse(data.content));
      } catch {
        setParsed(null);
      }
    },
    onError: (err) => toast.error(extractErrorMessage(err, "The assistant couldn't respond.")),
  });

  const applyScore = useMutation({
    mutationFn: async (s: { dimensionKey: string; dimensionLabel?: string; value: number }) =>
      apiClient.post(`/feasibility/${feasibilityId}/scores`, { dimensionKey: s.dimensionKey, dimensionLabel: s.dimensionLabel ?? s.dimensionKey, value: s.value, aiSuggested: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feasibility", feasibilityId] });
      toast.success("Score applied from the AI suggestion.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't apply that score.")),
  });

  const applyJustification = useMutation({
    mutationFn: async (text: string) => apiClient.put(`/feasibility/${feasibilityId}`, { description: text, aiSuggested: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feasibility", feasibilityId] });
      toast.success("Description updated from the AI suggestion.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't apply that justification.")),
  });

  return (
    <Modal title="AI Feasibility Analysis" isOpen={isOpen} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">Routed through the same assistant every module uses — it only ever suggests text. Nothing is saved until you click Apply below.</p>
        <TextAreaField label="Prompt (edit before generating)" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} />
        <button onClick={() => generate.mutate()} disabled={generate.isPending} className="w-fit rounded-md bg-button px-3 py-1.5 text-sm text-button-foreground disabled:opacity-60">
          {generate.isPending ? "Generating…" : "Generate"}
        </button>

        {raw && !parsed && (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
            <p className="mb-1 text-muted-foreground">Couldn't parse a structured suggestion — raw response:</p>
            <pre className="whitespace-pre-wrap">{raw}</pre>
          </div>
        )}

        {parsed && (
          <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-3">
            {parsed.scores && parsed.scores.length > 0 && (
              <div>
                <h4 className="mb-1 text-xs font-medium text-muted-foreground">Suggested scores</h4>
                <ul className="flex flex-col gap-2">
                  {parsed.scores.map((s, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 text-sm">
                      <span>
                        {s.dimensionLabel ?? s.dimensionKey}: <b>{s.value}</b>/5
                      </span>
                      <button onClick={() => applyScore.mutate(s)} disabled={applyScore.isPending} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                        Add
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {parsed.justification && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <h4 className="text-xs font-medium text-muted-foreground">Justification</h4>
                  <button onClick={() => applyJustification.mutate(parsed.justification!)} disabled={applyJustification.isPending} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                    Use as description
                  </button>
                </div>
                <p className="text-sm">{parsed.justification}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
