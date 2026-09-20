import { WORKFLOW_NODE_TYPES, getRegisteredActionKinds, type WorkflowNode, type WorkflowEdge } from "./workflow-engine.js";

export interface WorkflowGraphIssue {
  code: string;
  message: string;
  nodeId?: string;
  edge?: string;
}

export interface WorkflowGraphReport {
  /** True when there are no errors. Warnings never block. */
  valid: boolean;
  errors: WorkflowGraphIssue[];
  warnings: WorkflowGraphIssue[];
}

export interface WorkflowGraphInput {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  metadata?: Record<string, unknown>;
}

/** Integration nodes may only use these — each maps onto a real registered handler. */
export const INTEGRATION_KINDS = ["send_email", "notify_department", "notify_supplier", "erp_sync"] as const;

const CONDITION_OPERATORS = ["equals", "notEquals", "in", "greaterThan", "greaterOrEqual", "lessThan", "lessOrEqual", "contains"];

/**
 * Checks a workflow graph before it can be submitted for review or published:
 * every reference resolves, everything is reachable from a trigger, nothing
 * dead-ends, each node type is configured, and cycles are refused unless the
 * workflow explicitly allows them (\`metadata.allowLoops\`). Errors block
 * publishing; warnings are shown but do not.
 */
export function validateWorkflow(input: WorkflowGraphInput): WorkflowGraphReport {
  const errors: WorkflowGraphIssue[] = [];
  const warnings: WorkflowGraphIssue[] = [];
  const err = (code: string, message: string, extra: Partial<WorkflowGraphIssue> = {}) => errors.push({ code, message, ...extra });
  const warn = (code: string, message: string, extra: Partial<WorkflowGraphIssue> = {}) => warnings.push({ code, message, ...extra });

  const nodes = input.nodes ?? [];
  const edges = input.edges ?? [];
  const name = (n: WorkflowNode) => n.label || `${n.type} "${n.kind}"`;

  if (nodes.length === 0) {
    err("empty", "The workflow has no nodes.");
    return { valid: false, errors, warnings };
  }

  // ---- Identity and references ----------------------------------------------------------------------------------------------------------------------
  const byId = new Map<string, WorkflowNode>();
  for (const n of nodes) {
    if (byId.has(n.id)) err("duplicate_node", `Two nodes share the id "${n.id}".`, { nodeId: n.id });
    byId.set(n.id, n);
    if (!WORKFLOW_NODE_TYPES.includes(n.type)) err("unknown_type", `${name(n)} has an unknown type.`, { nodeId: n.id });
  }
  const seenEdges = new Set<string>();
  for (const e of edges) {
    const key = `${e.from}->${e.to}[${e.branch ?? ""}]`;
    if (!byId.has(e.from) || !byId.has(e.to)) {
      err("broken_transition", `A transition connects ${!byId.has(e.from) ? `a missing node "${e.from}"` : `"${e.from}"`} to ${!byId.has(e.to) ? `a missing node "${e.to}"` : `"${e.to}"`}.`, { edge: key });
      continue;
    }
    if (e.from === e.to) err("self_transition", `${name(byId.get(e.from)!)} is connected to itself.`, { nodeId: e.from, edge: key });
    if (seenEdges.has(key)) warn("duplicate_transition", `The transition ${e.from} → ${e.to} is drawn more than once.`, { edge: key });
    seenEdges.add(key);
  }
  if (errors.some((x) => x.code === "broken_transition" || x.code === "duplicate_node")) return { valid: false, errors, warnings };

  const out = new Map<string, WorkflowEdge[]>();
  const into = new Map<string, WorkflowEdge[]>();
  for (const e of edges) {
    out.set(e.from, [...(out.get(e.from) ?? []), e]);
    into.set(e.to, [...(into.get(e.to) ?? []), e]);
  }

  // ---- Triggers and reachability --------------------------------------------------------------------------------------------------------------------
  const triggers = nodes.filter((n) => n.type === "trigger");
  if (triggers.length === 0) err("no_trigger", "Add a trigger — a workflow with none never starts.");
  for (const t of triggers) if ((into.get(t.id) ?? []).length > 0) err("trigger_has_input", `${name(t)} is a trigger, so nothing may lead into it.`, { nodeId: t.id });

  const reachable = new Set<string>();
  const walk = (id: string) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const e of out.get(id) ?? []) walk(e.to);
  };
  for (const t of triggers) walk(t.id);
  for (const n of nodes) if (!reachable.has(n.id)) err("unreachable", `${name(n)} can never run — nothing connects it to a trigger.`, { nodeId: n.id });

  // ---- Per-type rules (no dead ends, required configuration) --------------------------------------------------------------------------------------------------
  const registered = new Set(getRegisteredActionKinds());
  for (const n of nodes) {
    const outgoing = out.get(n.id) ?? [];
    const branches = new Set(outgoing.map((e) => e.branch ?? ""));
    switch (n.type) {
      case "trigger":
        if (!n.kind) err("trigger_kind", `${name(n)} needs an event to listen for.`, { nodeId: n.id });
        if (outgoing.length === 0) err("dead_end", `${name(n)} leads nowhere.`, { nodeId: n.id });
        break;
      case "condition": {
        const cfg = n.config ?? {};
        if (!cfg.field) err("condition_field", `${name(n)} needs a field to test.`, { nodeId: n.id });
        else if (!CONDITION_OPERATORS.some((op) => cfg[op] !== undefined)) err("condition_operator", `${name(n)} needs a comparison (equals, greater than, ...).`, { nodeId: n.id });
        if (outgoing.length === 0) err("dead_end", `${name(n)} has no transitions out — a decision must lead somewhere.`, { nodeId: n.id });
        else {
          if (!branches.has("") && !branches.has("true")) warn("condition_true", `${name(n)} has no "true" path, so it can only ever end the run.`, { nodeId: n.id });
          for (const b of branches) if (b && b !== "true" && b !== "false") err("condition_branch", `${name(n)} has a transition labelled "${b}" — a condition's paths are "true" or "false".`, { nodeId: n.id });
        }
        break;
      }
      case "action":
        if (!n.kind) err("action_kind", `${name(n)} needs an action to perform.`, { nodeId: n.id });
        else if (!registered.has(n.kind)) warn("action_unregistered", `${name(n)} uses "${n.kind}", which the engine cannot perform yet; it will be skipped at run time.`, { nodeId: n.id });
        break; // an action with nothing after it is a normal way for a run to finish
      case "integration":
        if (!(INTEGRATION_KINDS as readonly string[]).includes(n.kind)) err("integration_kind", `${name(n)} must be one of: ${INTEGRATION_KINDS.join(", ")}.`, { nodeId: n.id });
        break;
      case "approval": {
        const cfg = n.config ?? {};
        if (!cfg.approverRole && !cfg.approverDepartment) err("approval_approver", `${name(n)} needs an approver role or department.`, { nodeId: n.id });
        if (outgoing.length === 0) err("dead_end", `${name(n)} has nothing after it — an approval must lead somewhere.`, { nodeId: n.id });
        else if (!branches.has("") && !branches.has("approved")) err("approval_approved", `${name(n)} has no "approved" path.`, { nodeId: n.id });
        for (const b of branches) if (b && b !== "approved" && b !== "rejected") err("approval_branch", `${name(n)} has a transition labelled "${b}" — an approval's paths are "approved" or "rejected".`, { nodeId: n.id });
        if (!branches.has("rejected")) warn("approval_rejected", `${name(n)} has no "rejected" path, so a rejection simply ends the run.`, { nodeId: n.id });
        break;
      }
      case "parallel":
        if (outgoing.length < 2) err("parallel_branches", `${name(n)} splits the flow, so it needs at least two transitions out.`, { nodeId: n.id });
        break;
      case "end":
        if (outgoing.length > 0) err("end_has_output", `${name(n)} ends the flow, so nothing may follow it.`, { nodeId: n.id });
        break;
    }
  }

  // ---- Loops ----------------------------------------------------------------------------------------------------------------------------------------
  // Depth-first search for a back edge. The engine runs each node once per run so a loop can never spin, but a cycle is almost
  // always a drawing mistake, so it needs to be asked for.
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>(nodes.map((n) => [n.id, WHITE]));
  let cycleAt: string | null = null;
  const dfs = (id: string) => {
    colour.set(id, GREY);
    for (const e of out.get(id) ?? []) {
      if (colour.get(e.to) === GREY) cycleAt ??= e.to;
      else if (colour.get(e.to) === WHITE) dfs(e.to);
    }
    colour.set(id, BLACK);
  };
  for (const n of nodes) if (colour.get(n.id) === WHITE) dfs(n.id);
  if (cycleAt) {
    const where = name(byId.get(cycleAt)!);
    if (input.metadata?.allowLoops === true) warn("loop", `The workflow loops back to ${where}. Each step still runs only once per run.`, { nodeId: cycleAt });
    else err("loop", `The workflow loops back to ${where}. Remove the loop, or allow loops in the workflow settings.`, { nodeId: cycleAt });
  }

  return { valid: errors.length === 0, errors, warnings };
}
