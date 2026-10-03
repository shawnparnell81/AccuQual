import { useEffect, useRef, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { TextField } from "../../components/forms/Field";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { Modal } from "../../components/modals/Modal";
import type { WorkflowDefinition, WorkflowTemplate, WorkflowHealthReport, WorkflowRun } from "../../api/types";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";

const workflowHooks = createResourceHooks<WorkflowDefinition>("workflow");

interface PendingRoute {
  decision: string;
  label: string;
  commentsRequired?: boolean;
}

interface PendingApproval {
  id: number;
  workflowId: number;
  workflowName: string;
  startedAt: string;
  pendingApproval?: { nodeId: string; label?: string; message?: string; approverRole?: string; approverDepartment?: string; workflowKey?: string; routes?: PendingRoute[] };
}

/** Approvals waiting on the signed-in user. Shown to everyone; empty for most people. */
function PendingApprovals() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: pending = [] } = useQuery<PendingApproval[]>({ queryKey: ["workflow/pending-approval"], queryFn: async () => (await apiClient.get("/workflow/runs/pending-approval")).data, refetchInterval: 60_000 });
  const [active, setActive] = useState<PendingApproval | null>(null);
  const [notes, setNotes] = useState("");
  const [rejectedBy, setRejectedBy] = useState("");
  const [rejectionDate, setRejectionDate] = useState("");

  const decide = useMutation({
    mutationFn: async ({ id, decision }: { id: number; decision: string }) => {
      const pending = active?.pendingApproval;
      const details = (pending?.workflowKey === "csa_fai" || pending?.workflowKey === "fpm_fai") && decision === "rejected" ? { rejectionReason: notes, rejectedBy, rejectionDate } : undefined;
      return (await apiClient.post(`/workflow/runs/${id}/decision`, { decision, notes: notes || undefined, details })).data;
    },
    onSuccess: (_d, v) => {
      const label = active?.pendingApproval?.routes?.find((route) => route.decision === v.decision)?.label;
      toast.success(label ? `${label} recorded. The workflow continues.` : v.decision === "approved" ? "Approved — the workflow continues." : "Rejected.");
      setActive(null);
      setNotes("");
      void queryClient.invalidateQueries({ queryKey: ["workflow/pending-approval"] });
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't record that decision.")),
  });

  if (pending.length === 0) return null;
  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 p-4">
      <h2 className="mb-2 text-sm font-medium">Waiting for your approval ({pending.length})</h2>
      <ul className="flex flex-col gap-2">
        {pending.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card p-2 text-sm">
            <span>
              <strong>{p.workflowName}</strong>
              <span className="text-muted-foreground"> — {p.pendingApproval?.message || p.pendingApproval?.label || "approval needed"}</span>
              <span className="block text-xs text-muted-foreground">Started {new Date(p.startedAt).toLocaleString()}</span>
            </span>
            <button onClick={() => setActive(p)} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
              Decide
            </button>
          </li>
        ))}
      </ul>
      <Modal title={active ? `${active.workflowName} — approval` : "Approval"} isOpen={active !== null} onClose={() => setActive(null)}>
        <div className="flex flex-col gap-3 text-sm">
          <p>{active?.pendingApproval?.message || active?.pendingApproval?.label}</p>
          <label className="flex flex-col gap-1">
            <span className="font-medium">{active?.pendingApproval?.routes?.some((route) => route.commentsRequired) ? "Notes" : "Notes (optional)"}</span>
            <textarea className="min-h-16 rounded-md border border-border bg-background p-2 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          {(active?.pendingApproval?.workflowKey === "csa_fai" || active?.pendingApproval?.workflowKey === "fpm_fai") && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="font-medium">Rejected by</span>
                <input className="rounded-md border border-border bg-background p-2 text-sm" value={rejectedBy} onChange={(e) => setRejectedBy(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-medium">Rejection date</span>
                <input type="date" className="rounded-md border border-border bg-background p-2 text-sm" value={rejectionDate} onChange={(e) => setRejectionDate(e.target.value)} />
              </label>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {(active?.pendingApproval?.routes?.length ? active.pendingApproval.routes : [
              { decision: "rejected", label: "Reject" },
              { decision: "approved", label: "Approve" },
            ]).map((route) => (
              <button
                key={route.decision}
                disabled={decide.isPending || (route.commentsRequired && notes.trim() === "")}
                onClick={() => active && decide.mutate({ id: active.id, decision: route.decision })}
                className={route.decision === "approved" ? "rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-60" : "rounded-md border border-border px-4 py-2 disabled:opacity-60"}
              >
                {route.label}
              </button>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}

/**
 * The workflow list: every workflow, its health, and quick access to the canvas. Editing happens on the canvas
 * (/workflow/:id), where changes are made as drafts that a reviewer approves before they go live.
 */
export function WorkflowBuilderPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { data: workflows = [] } = workflowHooks.useList();
  const { data: templates = [] } = useQuery<WorkflowTemplate[]>({ queryKey: ["workflow/templates"], queryFn: async () => (await apiClient.get("/workflow/templates")).data });
  const { data: health, refetch: refetchHealth } = useQuery<WorkflowHealthReport>({ queryKey: ["workflow/health"], queryFn: async () => (await apiClient.get("/workflow/health")).data });

  const updateWorkflow = workflowHooks.useUpdate();
  const deleteWorkflow = workflowHooks.useDelete();

  const [showHealth, setShowHealth] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [runResultOpen, setRunResultOpen] = useState(false);
  const [runResult, setRunResult] = useState<WorkflowRun | null>(null);
  const [runningSimulated, setRunningSimulated] = useState(false);

  const create = useMutation({
    mutationFn: async (input: { name: string; module?: string; definition?: WorkflowTemplate["definition"]; metadata?: WorkflowTemplate["metadata"] }) => (await apiClient.post<{ id: number }>("/workflow", input)).data,
    onSuccess: (created) => navigate(`/workflow/${created.id}`),
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't create the workflow.")),
  });
  const [params, setParams] = useSearchParams();
  const templateStarted = useRef(false);
  useEffect(() => {
    if (templateStarted.current || params.get("template") !== "validation") return;
    const template = templates.find((item) => item.key === "validation");
    if (!template) return;
    templateStarted.current = true;
    const next = new URLSearchParams(params);
    next.delete("template");
    setParams(next, { replace: true });
    create.mutate({ name: template.name, module: template.module, definition: template.definition, metadata: template.metadata });
  }, [create, params, setParams, templates]);

  const run = useMutation({
    mutationFn: async ({ id, simulate }: { id: number; simulate: boolean }) => (await apiClient.post<WorkflowRun>(`/workflow/${id}/run`, { context: {}, simulate })).data,
    onSuccess: (data, variables) => {
      setRunResult(data);
      setRunningSimulated(variables.simulate);
      setRunResultOpen(true);
      refetchHealth();
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't run this workflow.")),
  });

  function toggleActive(w: WorkflowDefinition) {
    updateWorkflow.mutate({ id: w.id, isActive: w.isActive === "true" ? "false" : "true" } as never, {
      onError: (err) => toast.error(extractErrorMessage(err, "Couldn't update.")),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Workflow Builder</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowHealth((s) => !s)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            {showHealth ? "Back to Workflows" : "Workflow Health"}
          </button>
          {!showHealth && (
            <button onClick={() => setCreating(true)} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
              + New Workflow
            </button>
          )}
        </div>
      </div>

      {health?.backgroundJobs === "off" && (
        <p className="rounded-lg border border-border bg-card p-4 text-sm">Background jobs are off on this deploy</p>
      )}

      <PendingApprovals />

      {showHealth ? (
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-medium">Workflow Health</h2>
          {!health ? (
            <LoadingPlaceholder />
          ) : (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { n: health.summary.total, label: "Total definitions" },
                  { n: health.summary.active, label: "Active" },
                  { n: health.summary.withIssues, label: "With issues" },
                  { n: health.summary.neverRun, label: "Never run" },
                ].map((s) => (
                  <div key={s.label} className="rounded-md border border-border p-3 text-center">
                    <p className="text-xl font-semibold">{s.n}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </div>
                ))}
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-2">Name</th>
                    <th className="pb-2">Module</th>
                    <th className="pb-2">Version</th>
                    <th className="pb-2">Last Success</th>
                    <th className="pb-2">Last Failure</th>
                    <th className="pb-2">Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {health.definitions.map((d) => (
                    <tr key={d.id} className="border-t border-border align-top">
                      <td className="py-1.5 font-medium">{d.name}</td>
                      <td className="py-1.5 text-muted-foreground">{d.module ?? "—"}</td>
                      <td className="py-1.5 tabular-nums">v{d.version}</td>
                      <td className="py-1.5 text-muted-foreground">{d.lastSuccessfulRunAt ? new Date(d.lastSuccessfulRunAt).toLocaleString() : "Never"}</td>
                      <td className="py-1.5 text-muted-foreground">{d.lastFailedRunAt ? <span title={d.lastFailedRunError ?? undefined}>{new Date(d.lastFailedRunAt).toLocaleString()}</span> : "Never"}</td>
                      <td className="py-1.5">
                        {d.issues.length === 0 ? (
                          <StatusBadge value="closed" label="Healthy" />
                        ) : (
                          <ul className="list-inside list-disc text-xs text-destructive">
                            {d.issues.map((issue, i) => (
                              <li key={i}>{issue}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                  {health.definitions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-3 text-center text-muted-foreground">
                        No workflow definitions yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-medium">Workflows</h2>
            <ul className="flex flex-col gap-2 text-sm">
              {workflows.map((w) => (
                <li key={w.id} className="flex flex-col gap-1.5 border-b border-border pb-2 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <Link to={`/workflow/${w.id}`} className="font-medium hover:underline">
                      {w.name}
                    </Link>
                    <StatusBadge value={w.isActive === "true" ? "closed" : "open"} label={w.isActive === "true" ? "Active" : "Inactive"} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {w.module ?? "no module"} · v{w.version}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <Link to={`/workflow/${w.id}`} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                      Open canvas
                    </Link>
                    <button onClick={() => toggleActive(w)} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                      {w.isActive === "true" ? "Deactivate" : "Activate"}
                    </button>
                    <button onClick={() => run.mutate({ id: w.id, simulate: true })} disabled={run.isPending} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">
                      Simulate
                    </button>
                    <button onClick={() => run.mutate({ id: w.id, simulate: false })} disabled={run.isPending} className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50">
                      Run
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete workflow "${w.name}"?`)) deleteWorkflow.mutate(w.id, { onError: (err) => toast.error(extractErrorMessage(err, "Couldn't delete it.")) });
                      }}
                      className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
              {workflows.length === 0 && <li className="text-muted-foreground">No workflows yet — start from a template or a blank canvas.</li>}
            </ul>
          </div>

          <div className="rounded-lg border border-dashed border-border bg-card p-4">
            <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Start from a template</p>
            <div className="flex flex-col gap-2">
              {templates.map((t) => (
                <button
                  key={t.key}
                  onClick={() => create.mutate({ name: t.name, module: t.module, definition: t.definition, metadata: t.metadata })}
                  disabled={create.isPending}
                  title={t.description}
                  className="rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-60"
                >
                  <span className="font-medium">{t.name}</span>
                  <span className="block text-xs text-muted-foreground">{t.description}</span>
                </button>
              ))}
              {templates.length === 0 && <p className="text-sm text-muted-foreground">No templates available.</p>}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">A new workflow starts as a draft. It goes live only after a reviewer approves it and it is published.</p>
          </div>
        </div>
      )}

      <Modal title="New workflow" isOpen={creating} onClose={() => setCreating(false)}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ name: newName.trim() });
          }}
        >
          <TextField label="Name" value={newName} onChange={(e) => setNewName(e.target.value)} required autoFocus />
          <button type="submit" disabled={create.isPending || !newName.trim()} className="w-fit rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            Create and open canvas
          </button>
        </form>
      </Modal>

      <Modal title={runningSimulated ? "Simulation result (no real actions were performed)" : "Run result"} isOpen={runResultOpen} onClose={() => setRunResultOpen(false)}>
        {runningSimulated && <p className="mb-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">This was a simulation — every action below shows what WOULD have happened; nothing was actually sent, created, or changed.</p>}
        {runResult?.status === "waiting_approval" && <p className="mb-2 rounded-md border border-primary/40 bg-primary/10 p-2 text-xs">The run is paused at an approval step. The assigned approver will see it under “Waiting for your approval”.</p>}
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{JSON.stringify(runResult, null, 2)}</pre>
      </Modal>
    </div>
  );
}
