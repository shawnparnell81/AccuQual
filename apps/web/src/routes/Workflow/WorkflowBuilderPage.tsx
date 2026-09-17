import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { TextField, SelectField } from "../../components/forms/Field";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { Modal } from "../../components/modals/Modal";
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge, WorkflowTemplate, WorkflowHealthReport, WorkflowRun } from "../../api/types";

const workflowHooks = createResourceHooks<WorkflowDefinition>("workflow");

// Phase 9 — trigger/condition kinds are still a curated, human-readable
// vocabulary (the engine itself will happily match ANY string a real
// publishEvent(WORKFLOW_STREAM, {event}) call emits — see workflow-engine.ts),
// but ACTION kinds are now fetched live from GET /workflow/action-kinds
// (the engine's own registry — see workflowActions.ts) so this dropdown can
// never silently drift from what the engine can actually execute, the exact
// gap the Phase 9 research flagged in the original 3-item hardcoded list.
const TRIGGER_KINDS = [
  "closed",
  "close",
  "verify",
  "step_completed",
  "approved",
  "rejected",
  "quarantined",
  "accepted",
  "auto_created_from_receiving",
  "escalated_from_receiving",
  "reorder-sent",
];
const CONDITION_OPERATORS = ["equals", "notEquals", "in", "greaterThan", "greaterOrEqual", "lessThan", "lessOrEqual", "contains"] as const;
type ConditionOperator = (typeof CONDITION_OPERATORS)[number];
const DEPARTMENT_OPTIONS = ["quality", "engineering", "production", "customer_service", "purchasing", "material_management", "sales_and_marketing"];

function newNode(type: WorkflowNode["type"], kind: string, id: string): WorkflowNode {
  return { id, type, kind, config: {} };
}

/** A condition node's config, rendered/edited as (field, operator, value) rather than a raw JSON blob. */
function ConditionFields({ node, onChange }: { node: WorkflowNode; onChange: (config: Record<string, unknown>) => void }) {
  const config = node.config as { field?: string; equals?: unknown; notEquals?: unknown; in?: unknown[]; greaterThan?: number; greaterOrEqual?: number; lessThan?: number; lessOrEqual?: number; contains?: string };
  const [operator, setOperator] = useState<ConditionOperator>(
    (Object.keys(config).find((k) => CONDITION_OPERATORS.includes(k as ConditionOperator)) as ConditionOperator) ?? "equals"
  );
  const rawValue = config[operator as keyof typeof config];
  const [valueText, setValueText] = useState(Array.isArray(rawValue) ? rawValue.join(", ") : rawValue !== undefined ? String(rawValue) : "");

  function commit(nextOperator: ConditionOperator, nextValueText: string) {
    const isNumeric = nextOperator === "greaterThan" || nextOperator === "greaterOrEqual" || nextOperator === "lessThan" || nextOperator === "lessOrEqual";
    const value: unknown = nextOperator === "in" ? nextValueText.split(",").map((v) => v.trim()).filter(Boolean) : isNumeric ? Number(nextValueText) : nextValueText;
    onChange({ field: config.field, [nextOperator]: value });
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      <TextField label="Field (from event context)" placeholder="e.g. severity, supplierId, defectCategory" value={config.field ?? ""} onChange={(e) => onChange({ ...config, field: e.target.value })} />
      <SelectField
        label="Operator"
        value={operator}
        onChange={(e) => {
          const next = e.target.value as ConditionOperator;
          setOperator(next);
          commit(next, valueText);
        }}
      >
        {CONDITION_OPERATORS.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </SelectField>
      <TextField
        label={operator === "in" ? "Value (comma-separated)" : "Value"}
        value={valueText}
        onChange={(e) => {
          setValueText(e.target.value);
          commit(operator, e.target.value);
        }}
      />
    </div>
  );
}

/** An action node's config — fields shown depend on the real, registered action kind (see workflowActions.ts for what each one actually reads). */
function ActionFields({ node, onChange }: { node: WorkflowNode; onChange: (config: Record<string, unknown>) => void }) {
  const config = node.config as Record<string, string | undefined>;
  const set = (key: string, value: string) => onChange({ ...config, [key]: value });

  switch (node.kind) {
    case "send_email":
      return (
        <div className="grid grid-cols-2 gap-2">
          <TextField label="To (literal email, optional)" value={config.to ?? ""} onChange={(e) => set("to", e.target.value)} />
          <TextField label="To field (context key, optional)" placeholder="e.g. contactEmail" value={config.toField ?? ""} onChange={(e) => set("toField", e.target.value)} />
          <TextField label="Subject" value={config.subject ?? ""} onChange={(e) => set("subject", e.target.value)} />
          <TextField label="Body" value={config.body ?? ""} onChange={(e) => set("body", e.target.value)} />
        </div>
      );
    case "notify_department":
      return (
        <div className="grid grid-cols-2 gap-2">
          <SelectField label="Department" value={config.department ?? ""} onChange={(e) => set("department", e.target.value)}>
            <option value="">Select…</option>
            {DEPARTMENT_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d.replace(/_/g, " ")}
              </option>
            ))}
          </SelectField>
          <TextField label="Subject" value={config.subject ?? ""} onChange={(e) => set("subject", e.target.value)} />
          <TextField label="Body" value={config.body ?? ""} onChange={(e) => set("body", e.target.value)} />
        </div>
      );
    case "notify_supplier":
      return (
        <div className="grid grid-cols-2 gap-2">
          <TextField label="Subject" value={config.subject ?? ""} onChange={(e) => set("subject", e.target.value)} />
          <TextField label="Body" value={config.body ?? ""} onChange={(e) => set("body", e.target.value)} />
        </div>
      );
    case "create_ncr":
      return (
        <div className="grid grid-cols-2 gap-2">
          <TextField label="Title (supports {{field}})" value={config.title ?? ""} onChange={(e) => set("title", e.target.value)} />
          <TextField label="Description" value={config.description ?? ""} onChange={(e) => set("description", e.target.value)} />
          <SelectField label="Severity" value={config.severity ?? ""} onChange={(e) => set("severity", e.target.value)}>
            <option value="">Unset</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </SelectField>
        </div>
      );
    case "escalate_capa":
      return <TextField label="Root cause (supports {{field}})" value={config.rootCause ?? ""} onChange={(e) => set("rootCause", e.target.value)} />;
    case "assign_user":
      return (
        <div className="grid grid-cols-2 gap-2">
          <SelectField label="Module" value={config.module ?? ""} onChange={(e) => set("module", e.target.value)}>
            <option value="">Select…</option>
            <option value="ncr">NCR</option>
            <option value="capa">CAPA</option>
          </SelectField>
          <TextField label="User ID" type="number" value={config.userId ?? ""} onChange={(e) => set("userId", e.target.value)} />
        </div>
      );
    case "ai_suggestion":
      return <p className="text-xs text-muted-foreground">No configuration needed — calls the workflow AI-note pipeline with this run's full event context.</p>;
    default:
      return <p className="text-xs text-muted-foreground">Unrecognized action kind — check Health for details.</p>;
  }
}

function DefinitionEditor({
  initialName,
  initialModule,
  initialNodes,
  onSave,
  saving,
  actionKinds,
}: {
  initialName: string;
  initialModule: string;
  initialNodes: WorkflowNode[];
  onSave: (name: string, module: string, nodes: WorkflowNode[], edges: WorkflowEdge[]) => void;
  saving: boolean;
  actionKinds: string[];
}) {
  const [name, setName] = useState(initialName);
  const [module, setModule] = useState(initialModule);
  const [nodes, setNodes] = useState<WorkflowNode[]>(initialNodes);

  useEffect(() => {
    setName(initialName);
    setModule(initialModule);
    setNodes(initialNodes);
  }, [initialName, initialModule, initialNodes]);

  function addNode(type: WorkflowNode["type"]) {
    const kind = type === "trigger" ? TRIGGER_KINDS[0]! : type === "condition" ? "" : (actionKinds[0] ?? "");
    setNodes((n) => [...n, newNode(type, kind, `n${n.length + 1}-${Date.now()}`)]);
  }
  function removeNode(id: string) {
    setNodes((n) => n.filter((node) => node.id !== id));
  }
  function updateNode(id: string, patch: Partial<WorkflowNode>) {
    setNodes((n) => n.map((node) => (node.id === id ? { ...node, ...patch } : node)));
  }

  function save() {
    // Same simple "one straight chain" edge model the original page used —
    // each node's only child is the next one in the list. A real branching
    // canvas is a natural follow-up; this is enough to express every
    // template above and every real condition/action combination this
    // phase's engine supports.
    const edges = nodes.slice(1).map((node, i) => ({ from: nodes[i]!.id, to: node.id }));
    onSave(name, module, nodes, edges);
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <TextField label="Workflow name" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Module (real ResourceKey, e.g. ncr, capa, receiving)" value={module} onChange={(e) => setModule(e.target.value)} />
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {nodes.map((node) => (
          <div key={node.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 rounded-full bg-muted px-2 py-0.5 text-center text-xs capitalize">{node.type}</span>
              {node.type === "trigger" && (
                <SelectField label="" value={node.kind} onChange={(e) => updateNode(node.id, { kind: e.target.value })}>
                  {TRIGGER_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </SelectField>
              )}
              {node.type === "action" && (
                <SelectField label="" value={node.kind} onChange={(e) => updateNode(node.id, { kind: e.target.value, config: {} })}>
                  {actionKinds.length === 0 && <option value="">No action kinds registered</option>}
                  {actionKinds.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </SelectField>
              )}
              {node.type === "condition" && <span className="text-xs text-muted-foreground">Condition — configured below</span>}
              <button onClick={() => removeNode(node.id)} className="ml-auto text-xs text-muted-foreground hover:text-destructive">
                Remove
              </button>
            </div>
            {node.type === "condition" && <ConditionFields node={node} onChange={(config) => updateNode(node.id, { config })} />}
            {node.type === "action" && <ActionFields node={node} onChange={(config) => updateNode(node.id, { config })} />}
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => addNode("trigger")} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
          + Trigger
        </button>
        <button onClick={() => addNode("condition")} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
          + Condition
        </button>
        <button onClick={() => addNode("action")} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
          + Action
        </button>
        <button onClick={save} disabled={saving || !name.trim()} className="ml-auto rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
          {saving ? "Saving…" : "Save workflow"}
        </button>
      </div>
    </div>
  );
}

/**
 * Workflow Builder — Phase 9. Strengthens the existing, already-live
 * drag-and-drop-in-a-list editor (see workflow-engine.ts's own comment on
 * why this session chose to strengthen the real, deployed engine rather
 * than rip out every module's own proven transition logic): real condition
 * operators, real registered action kinds (not a hardcoded 3-item list),
 * starter templates, edit/delete/versioning, a health panel, and
 * Simulation Mode. Deliberately NOT moved to Platform Admin — see
 * tenants.ts's own precedent (Settings, not Platform Admin, is where every
 * other tenant-scoped "config a human edits" already lives); this stays
 * the tenant-scoped `/workflow` route, now under the new "workflow"
 * ResourceKey's own RBAC gate.
 */
export function WorkflowBuilderPage() {
  const toast = useToast();
  const { data: workflows = [] } = workflowHooks.useList();
  const { data: actionKinds = [] } = useQuery<string[]>({ queryKey: ["workflow/action-kinds"], queryFn: async () => (await apiClient.get("/workflow/action-kinds")).data });
  const { data: templates = [] } = useQuery<WorkflowTemplate[]>({ queryKey: ["workflow/templates"], queryFn: async () => (await apiClient.get("/workflow/templates")).data });
  const { data: health, refetch: refetchHealth } = useQuery<WorkflowHealthReport>({ queryKey: ["workflow/health"], queryFn: async () => (await apiClient.get("/workflow/health")).data });

  const createWorkflow = workflowHooks.useCreate();
  const updateWorkflow = workflowHooks.useUpdate();
  const deleteWorkflow = workflowHooks.useDelete();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ name: string; module: string; nodes: WorkflowNode[]; edges: WorkflowEdge[] } | null>({
    name: "",
    module: "",
    nodes: [newNode("trigger", TRIGGER_KINDS[0]!, "n1")],
    edges: [],
  });
  const [showHealth, setShowHealth] = useState(false);
  const [runResultOpen, setRunResultOpen] = useState(false);
  const [runResult, setRunResult] = useState<WorkflowRun | null>(null);
  const [runningSimulated, setRunningSimulated] = useState(false);

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

  function startNew() {
    setEditingId(null);
    setDraft({ name: "", module: "", nodes: [newNode("trigger", TRIGGER_KINDS[0]!, "n1")], edges: [] });
  }
  function startEdit(w: WorkflowDefinition) {
    setEditingId(w.id);
    setDraft({ name: w.name, module: w.module ?? "", nodes: w.definition.nodes, edges: w.definition.edges });
  }
  function loadTemplate(t: WorkflowTemplate) {
    setEditingId(null);
    setDraft({ name: t.name, module: t.module, nodes: t.definition.nodes, edges: t.definition.edges });
    toast.success(`Loaded "${t.name}" — review and Save to create it.`);
  }

  function handleSave(name: string, module: string, nodes: WorkflowNode[], edges: WorkflowEdge[]) {
    const definition = { nodes, edges };
    if (editingId) {
      updateWorkflow.mutate(
        { id: editingId, name, module: module || null, definition } as never,
        { onSuccess: () => toast.success("Workflow updated."), onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save.")) }
      );
    } else {
      createWorkflow.mutate({ name, module: module || undefined, definition } as never, {
        onSuccess: () => {
          toast.success("Workflow created.");
          startNew();
        },
        onError: (err) => toast.error(extractErrorMessage(err, "Couldn't create workflow.")),
      });
    }
  }

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
            {showHealth ? "Back to Builder" : "Workflow Health"}
          </button>
          {!showHealth && (
            <button onClick={startNew} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              + New Workflow
            </button>
          )}
        </div>
      </div>

      {showHealth ? (
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-medium">Workflow Health</h2>
          {!health ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-md border border-border p-3 text-center">
                  <p className="text-xl font-semibold">{health.summary.total}</p>
                  <p className="text-xs text-muted-foreground">Total definitions</p>
                </div>
                <div className="rounded-md border border-border p-3 text-center">
                  <p className="text-xl font-semibold">{health.summary.active}</p>
                  <p className="text-xs text-muted-foreground">Active</p>
                </div>
                <div className="rounded-md border border-border p-3 text-center">
                  <p className="text-xl font-semibold">{health.summary.withIssues}</p>
                  <p className="text-xs text-muted-foreground">With issues</p>
                </div>
                <div className="rounded-md border border-border p-3 text-center">
                  <p className="text-xl font-semibold">{health.summary.neverRun}</p>
                  <p className="text-xs text-muted-foreground">Never run</p>
                </div>
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
                      <td className="py-1.5 text-muted-foreground">
                        {d.lastFailedRunAt ? (
                          <span title={d.lastFailedRunError ?? undefined}>{new Date(d.lastFailedRunAt).toLocaleString()}</span>
                        ) : (
                          "Never"
                        )}
                      </td>
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
          <div className="flex flex-col gap-4">
            {templates.length > 0 && (
              <div className="rounded-lg border border-dashed border-border bg-card p-3">
                <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Starter Templates</p>
                <div className="flex flex-wrap gap-2">
                  {templates.map((t) => (
                    <button key={t.key} onClick={() => loadTemplate(t)} title={t.description} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {draft && (
              <DefinitionEditor
                key={editingId ?? "new"}
                initialName={draft.name}
                initialModule={draft.module}
                initialNodes={draft.nodes}
                onSave={handleSave}
                saving={createWorkflow.isPending || updateWorkflow.isPending}
                actionKinds={actionKinds}
              />
            )}
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-medium">Saved Workflows</h2>
            <ul className="flex flex-col gap-2 text-sm">
              {workflows.map((w) => (
                <li key={w.id} className="flex flex-col gap-1.5 border-b border-border pb-2 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <button onClick={() => startEdit(w)} className="text-left font-medium hover:underline">
                      {w.name}
                    </button>
                    <StatusBadge value={w.isActive === "true" ? "closed" : "open"} label={w.isActive === "true" ? "Active" : "Inactive"} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {w.module ?? "no module"} · v{w.version}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
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
                        if (confirm(`Delete workflow "${w.name}"?`)) deleteWorkflow.mutate(w.id, { onSuccess: () => editingId === w.id && startNew() });
                      }}
                      className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
              {workflows.length === 0 && <li className="text-muted-foreground">No workflows yet — load a template or start from scratch.</li>}
            </ul>
          </div>
        </div>
      )}

      <Modal title={runningSimulated ? "Simulation result (no real actions were performed)" : "Run result"} isOpen={runResultOpen} onClose={() => setRunResultOpen(false)}>
        {runningSimulated && (
          <p className="mb-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
            This was a simulation — every action below shows what WOULD have happened; nothing was actually sent, created, or changed.
          </p>
        )}
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{JSON.stringify(runResult, null, 2)}</pre>
      </Modal>
    </div>
  );
}
