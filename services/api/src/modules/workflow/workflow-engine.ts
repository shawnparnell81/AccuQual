/**
 * Drag-and-drop workflow engine executor.
 *
 * A workflow definition is a graph of nodes joined by transitions:
 *   trigger      where a run starts (matched against the event that fired)
 *   condition    routes on the run context — a passing condition follows its
 *                "true" (or unlabelled) transitions, a failing one its "false" ones
 *   action       runs a registered handler (assign a user, create an NCR, ...)
 *   integration  runs a registered handler that talks to something outside the
 *                app (email, notifications, the ERP sync)
 *   approval     pauses the run until a person approves or rejects; then follows
 *                the "approved" or "rejected" transitions
 *   parallel     fans out to every transition
 *   end          ends its branch
 *
 * Execution is deterministic: the same definition and context always visit the
 * same nodes in the same order (depth-first, transitions in the order they are
 * stored), and every node runs at most once per run. `executeWorkflow` returns
 * the run's state so a paused run (waiting on an approval) can be saved and
 * resumed with `resumeWorkflow`; `runWorkflow` is the original, simpler entry
 * point that just returns the finished context.
 *
 * Real trigger dispatch (NCR created, CAPA closed, ...) happens in the
 * workflow-worker process, which consumes `WORKFLOW_STREAM` events and calls
 * this same executor — see /workers/workflow-worker.
 */

export type WorkflowNodeType = "trigger" | "condition" | "action" | "integration" | "approval" | "parallel" | "end";
export const WORKFLOW_NODE_TYPES: readonly WorkflowNodeType[] = ["trigger", "condition", "action", "integration", "approval", "parallel", "end"];

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  kind: string;
  config: Record<string, unknown>;
  /** Display name on the canvas. */
  label?: string;
  /** Where the node sits on the canvas. Purely visual — never affects execution. */
  position?: { x: number; y: number };
}

export interface WorkflowEdge {
  from: string;
  to: string;
  /** "true" | "false" out of a condition, "approved" | "rejected" out of an approval. Unlabelled = the default path. */
  branch?: string;
  label?: string;
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

/**
 * Phase 9 — `dryRun` is how Simulation Mode (task 9) reaches every
 * registered action handler without a special "simulated" copy of each
 * one: a real handler with a real side effect (send an email, insert an
 * NCR) checks `dryRun` itself and, when true, records what it WOULD have
 * done into `context.actionsRun` instead of doing it — see
 * workflowActions.ts's own comment. The graph-walking/condition-evaluation
 * logic itself is identical in both modes, so a simulation genuinely
 * exercises the same reachability/condition/RBAC-context path a real run
 * would, not a separate, potentially-diverging code path.
 */
export type ActionHandler = (node: WorkflowNode, context: Record<string, unknown>, dryRun: boolean) => Promise<void> | void;

const actionRegistry: Record<string, ActionHandler> = {};

export function registerActionHandler(kind: string, handler: ActionHandler) {
  actionRegistry[kind] = handler;
}

/** The real, currently-registered action kinds — read by workflow.controller.ts's actionKindsHandler and healthHandler (a definition referencing an unregistered kind is a real "missing action" health warning, task 8). */
export function getRegisteredActionKinds(): string[] {
  return Object.keys(actionRegistry);
}

/**
 * Phase 9 task 5 — real condition operators beyond the original
 * equals/greaterThan pair, covering the brief's own condition list
 * (defect category → equals/in, supplier → equals, recurrence →
 * greaterThan/greaterOrEqual, severity → equals/in, inspection results →
 * equals). `field` supports one level of dot-path (e.g. "breakdown.ncrFactor")
 * since several real event contexts (receiving automation, supplier risk)
 * nest data one level deep; deeper nesting isn't needed by anything today.
 */
function resolveField(context: Record<string, unknown>, field: string): unknown {
  if (!field.includes(".")) return context[field];
  const [head, ...rest] = field.split(".");
  const nested = context[head!];
  if (rest.length === 0 || typeof nested !== "object" || nested === null) return nested;
  return resolveField(nested as Record<string, unknown>, rest.join("."));
}

function evaluateCondition(node: WorkflowNode, context: Record<string, unknown>): boolean {
  const { field, equals, notEquals, in: inList, greaterThan, greaterOrEqual, lessThan, lessOrEqual, contains } = node.config as {
    field?: string;
    equals?: unknown;
    notEquals?: unknown;
    in?: unknown[];
    greaterThan?: number;
    greaterOrEqual?: number;
    lessThan?: number;
    lessOrEqual?: number;
    contains?: string;
  };
  if (!field) return true;
  const value = resolveField(context, field);

  if (equals !== undefined) return value === equals;
  if (notEquals !== undefined) return value !== notEquals;
  if (Array.isArray(inList)) return inList.includes(value);
  if (greaterThan !== undefined) return typeof value === "number" && value > greaterThan;
  if (greaterOrEqual !== undefined) return typeof value === "number" && value >= greaterOrEqual;
  if (lessThan !== undefined) return typeof value === "number" && value < lessThan;
  if (lessOrEqual !== undefined) return typeof value === "number" && value <= lessOrEqual;
  if (contains !== undefined) return typeof value === "string" && value.includes(contains);
  return true;
}

/** The saved position of a run that stopped at an approval node. */
export interface WorkflowRunState {
  /** Nodes still to visit, top of the stack last. */
  stack: string[];
  /** Nodes already visited (each runs once per run). */
  visited: string[];
  /** The approval node the run is paused on, if any. */
  waitingNodeId: string | null;
}

export type WorkflowExecutionStatus = "completed" | "waiting_approval";

export interface WorkflowExecutionResult {
  context: Record<string, unknown>;
  status: WorkflowExecutionStatus;
  /** The node the run last reached (the approval node, when waiting). */
  currentNodeId: string | null;
  state: WorkflowRunState;
}

/** Thrown when a node's handler fails, so callers can record which node the run died on. */
export class WorkflowNodeError extends Error {
  constructor(public readonly nodeId: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "WorkflowNodeError";
  }
}

export type ApprovalDecision = "approved" | "rejected";

interface ExecuteOptions {
  triggerKind?: string;
  dryRun?: boolean;
}

function recordStep(context: Record<string, unknown>, node: WorkflowNode, result: string) {
  context.steps = [...((context.steps as unknown[]) ?? []), { node: node.id, type: node.type, kind: node.kind, result, at: new Date().toISOString() }];
}

/** Which of a node's outgoing transitions to follow, given what the node decided. */
function followable(edges: WorkflowEdge[], outcome: "default" | "true" | "false" | ApprovalDecision): string[] {
  return edges
    .filter((e) => {
      if (outcome === "true") return e.branch === undefined || e.branch === "" || e.branch === "true";
      if (outcome === "false") return e.branch === "false";
      if (outcome === "approved") return e.branch === undefined || e.branch === "" || e.branch === "approved";
      if (outcome === "rejected") return e.branch === "rejected";
      return true;
    })
    .map((e) => e.to);
}

async function drive(
  definition: WorkflowDefinition,
  context: Record<string, unknown>,
  state: WorkflowRunState,
  dryRun: boolean
): Promise<WorkflowExecutionResult> {
  const nodesById = new Map(definition.nodes.map((n) => [n.id, n]));
  const edgesFrom = new Map<string, WorkflowEdge[]>();
  for (const edge of definition.edges) edgesFrom.set(edge.from, [...(edgesFrom.get(edge.from) ?? []), edge]);

  const visited = new Set(state.visited);
  const stack = [...state.stack];
  let currentNodeId: string | null = state.waitingNodeId;

  // Push children so the FIRST transition is visited first (and its whole subtree before the next) — the depth-first order
  // this engine has always had. Full-System Audit finding C5: a company-authored cycle used to recurse forever and crash the
  // shared worker; the visited set below (each node runs once per run) is what makes that impossible.
  const push = (ids: string[]) => {
    for (let i = ids.length - 1; i >= 0; i--) stack.push(ids[i]!);
  };

  while (stack.length > 0) {
    const nodeId = stack.pop()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    const node = nodesById.get(nodeId);
    if (!node) continue;
    currentNodeId = node.id;
    const outgoing = edgesFrom.get(node.id) ?? [];

    try {
      switch (node.type) {
        case "condition": {
          const passed = evaluateCondition(node, context);
          context.conditionsEvaluated = [...((context.conditionsEvaluated as unknown[]) ?? []), { node: node.id, kind: node.kind, passed }];
          recordStep(context, node, passed ? "passed" : "failed");
          push(followable(outgoing, passed ? "true" : "false")); // a failing condition with no "false" transition simply ends the branch
          break;
        }
        case "action":
        case "integration": {
          const handler = actionRegistry[node.kind];
          if (handler) {
            await handler(node, context, dryRun);
            recordStep(context, node, dryRun ? "simulated" : "done");
          } else {
            context.unregisteredActions = [...((context.unregisteredActions as unknown[]) ?? []), { node: node.id, kind: node.kind }];
            recordStep(context, node, "skipped: no handler registered");
          }
          push(followable(outgoing, "default"));
          break;
        }
        case "approval": {
          if (dryRun) {
            // A simulation never waits on a person; it takes the path named in the context (default: approved).
            const decision: ApprovalDecision = context.simulateApproval === "rejected" ? "rejected" : "approved";
            recordStep(context, node, `simulated: ${decision}`);
            push(followable(outgoing, decision));
            break;
          }
          context.pendingApproval = { nodeId: node.id, label: node.label ?? node.kind, ...node.config };
          recordStep(context, node, "waiting for approval");
          return { context, status: "waiting_approval", currentNodeId: node.id, state: { stack, visited: [...visited], waitingNodeId: node.id } };
        }
        case "end":
          recordStep(context, node, "end");
          break; // nothing follows an end node
        case "parallel":
          recordStep(context, node, `fan-out to ${outgoing.length}`);
          push(followable(outgoing, "default"));
          break;
        default: // trigger reached as a child, or an unknown type: pass through
          push(followable(outgoing, "default"));
      }
    } catch (err) {
      throw new WorkflowNodeError(node.id, err);
    }
  }

  delete context.pendingApproval;
  return { context, status: "completed", currentNodeId, state: { stack: [], visited: [...visited], waitingNodeId: null } };
}

/** Starts a run from every trigger node matching `triggerKind` (all triggers when omitted). */
export async function executeWorkflow(definition: WorkflowDefinition, context: Record<string, unknown>, options: ExecuteOptions = {}): Promise<WorkflowExecutionResult> {
  const { triggerKind, dryRun = false } = options;
  const triggers = definition.nodes.filter((n) => n.type === "trigger" && (!triggerKind || n.kind === triggerKind));
  const stack: string[] = [];
  for (let t = triggers.length - 1; t >= 0; t--) {
    const children = definition.edges.filter((e) => e.from === triggers[t]!.id).map((e) => e.to);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
  }
  return drive(definition, context, { stack, visited: [], waitingNodeId: null }, dryRun);
}

/**
 * Continues a run that stopped at an approval node: records the decision, then follows the approved
 * (or rejected) transitions from that node.
 */
export async function resumeWorkflow(
  definition: WorkflowDefinition,
  state: WorkflowRunState,
  context: Record<string, unknown>,
  decision: ApprovalDecision,
  options: { dryRun?: boolean } = {}
): Promise<WorkflowExecutionResult> {
  if (!state.waitingNodeId) throw new Error("This run is not waiting for an approval");
  const outgoing = definition.edges.filter((e) => e.from === state.waitingNodeId);
  const next = followable(outgoing, decision);
  const stack = [...state.stack];
  for (let i = next.length - 1; i >= 0; i--) stack.push(next[i]!);
  delete context.pendingApproval;
  return drive(definition, context, { stack, visited: state.visited, waitingNodeId: null }, options.dryRun ?? false);
}

/** The original entry point: runs to the end (or to the first approval) and returns just the context. */
export async function runWorkflow(
  definition: WorkflowDefinition,
  context: Record<string, unknown>,
  triggerKind?: string,
  dryRun = false
): Promise<Record<string, unknown>> {
  return (await executeWorkflow(definition, context, { triggerKind, dryRun })).context;
}
