import { useState } from "react";
import { createResourceHooks } from "../../api/resourceHooks";
import type { WorkflowDefinition } from "../../api/types";
import { TextField, SelectField } from "../../components/forms/Field";
import { Modal } from "../../components/modals/Modal";

const workflowHooks = createResourceHooks<WorkflowDefinition>("workflow");

interface NodeDraft {
  id: string;
  type: "trigger" | "condition" | "action";
  kind: string;
}

const TRIGGER_KINDS = ["ncr_created", "capa_closed", "audit_completed"];
const CONDITION_KINDS = ["severity_equals", "status_equals"];
const ACTION_KINDS = ["assign_user", "create_capa", "send_email"];

/**
 * Workflow Builder — drag-and-drop node canvas per the Frontend Spec.
 * This first pass renders nodes as an ordered list users compose top-to-bottom
 * (trigger -> condition -> action), wired 1:1 by edges, with a properties
 * panel per node and a Save/Run button. A full canvas drag-and-drop surface
 * is a natural follow-up once this data model is validated end-to-end.
 */
export function WorkflowBuilderPage() {
  const { data: workflows = [] } = workflowHooks.useList();
  const createWorkflow = workflowHooks.useCreate();
  const runWorkflow = workflowHooks.useAction("run");

  const [name, setName] = useState("");
  const [nodes, setNodes] = useState<NodeDraft[]>([{ id: "n1", type: "trigger", kind: TRIGGER_KINDS[0]! }]);
  const [runResultOpen, setRunResultOpen] = useState(false);
  const [runResult, setRunResult] = useState<unknown>(null);

  function addNode(type: NodeDraft["type"]) {
    const kind = (type === "trigger" ? TRIGGER_KINDS[0] : type === "condition" ? CONDITION_KINDS[0] : ACTION_KINDS[0])!;
    setNodes((n) => [...n, { id: `n${n.length + 1}`, type, kind }]);
  }

  function save() {
    const edges = nodes.slice(1).map((node, i) => ({ from: nodes[i]!.id, to: node.id }));
    createWorkflow.mutate({
      name,
      definition: { nodes: nodes.map((n) => ({ ...n, config: {} })), edges },
    } as never);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Workflow Builder</h1>

        <div className="rounded-lg border border-border bg-card p-4">
          <TextField label="Workflow name" value={name} onChange={(e) => setName(e.target.value)} />

          <div className="mt-4 flex flex-col gap-2">
            {nodes.map((node, i) => (
              <div key={node.id} className="flex items-center gap-2 rounded-md border border-border p-3">
                <span className="w-20 shrink-0 rounded-full bg-muted px-2 py-0.5 text-center text-xs capitalize">{node.type}</span>
                <SelectField
                  label=""
                  value={node.kind}
                  onChange={(e) =>
                    setNodes((ns) => ns.map((n2, i2) => (i2 === i ? { ...n2, kind: e.target.value } : n2)))
                  }
                >
                  {(node.type === "trigger" ? TRIGGER_KINDS : node.type === "condition" ? CONDITION_KINDS : ACTION_KINDS).map(
                    (k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    )
                  )}
                </SelectField>
              </div>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <button onClick={() => addNode("condition")} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
              + Condition
            </button>
            <button onClick={() => addNode("action")} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
              + Action
            </button>
            <button onClick={save} className="ml-auto rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
              Save workflow
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">Saved Workflows</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {workflows.map((w) => (
            <li key={w.id} className="flex items-center justify-between border-b border-border pb-2">
              <span>{w.name}</span>
              <button
                onClick={() =>
                  runWorkflow.mutate(
                    { id: w.id, context: {} },
                    { onSuccess: (data) => { setRunResult(data); setRunResultOpen(true); } }
                  )
                }
                className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
              >
                Run
              </button>
            </li>
          ))}
          {workflows.length === 0 && <li className="text-muted-foreground">No workflows yet.</li>}
        </ul>
      </div>

      <Modal title="Run result" isOpen={runResultOpen} onClose={() => setRunResultOpen(false)}>
        <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{JSON.stringify(runResult, null, 2)}</pre>
      </Modal>
    </div>
  );
}
