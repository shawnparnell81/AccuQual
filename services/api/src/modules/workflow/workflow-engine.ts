/**
 * Minimal drag-and-drop workflow engine executor.
 *
 * A workflow definition is a graph of trigger -> condition -> action nodes.
 * `runWorkflow` walks the graph from every trigger node, short-circuiting a
 * branch the moment a condition node evaluates false, and invokes the
 * registered handler for every action node it reaches.
 *
 * Real trigger dispatch (NCR created, CAPA closed, ...) happens in the
 * workflow-worker process, which consumes `WORKFLOW_STREAM` events and calls
 * this same executor — see /workers/workflow-worker.
 */

export interface WorkflowNode {
  id: string;
  type: "trigger" | "condition" | "action";
  kind: string;
  config: Record<string, unknown>;
}

export interface WorkflowEdge {
  from: string;
  to: string;
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

export async function runWorkflow(
  definition: WorkflowDefinition,
  context: Record<string, unknown>,
  triggerKind?: string,
  dryRun = false
): Promise<Record<string, unknown>> {
  const nodesById = new Map(definition.nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, string[]>();
  for (const edge of definition.edges) {
    childrenOf.set(edge.from, [...(childrenOf.get(edge.from) ?? []), edge.to]);
  }

  const triggers = definition.nodes.filter((n) => n.type === "trigger" && (!triggerKind || n.kind === triggerKind));

  // Full-System Audit finding C5: no cycle detection existed here, and the
  // save-time schema never checks graph structure either — a tenant-authored
  // workflow with an edge back to an earlier node (via the drag-and-drop
  // builder) recursed forever the next time a matching trigger fired,
  // crashing the shared workflow-worker process for every tenant. One
  // shared visited-set for this whole run (not per top-level trigger) is
  // the simplest correct fix for this engine's shape: each action already
  // fires once per run, so a diamond-shaped graph re-reaching a node now
  // fires it once instead of twice — arguably more correct anyway, not
  // just an incidental side effect of the guard.
  const visited = new Set<string>();
  async function walk(nodeId: string) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = nodesById.get(nodeId);
    if (!node) return;

    if (node.type === "condition") {
      const passed = evaluateCondition(node, context);
      context.conditionsEvaluated = [...((context.conditionsEvaluated as unknown[]) ?? []), { node: node.id, kind: node.kind, passed }];
      if (!passed) return; // short-circuit this branch
    }

    if (node.type === "action") {
      const handler = actionRegistry[node.kind];
      if (handler) {
        await handler(node, context, dryRun);
      } else {
        context.unregisteredActions = [...((context.unregisteredActions as unknown[]) ?? []), { node: node.id, kind: node.kind }];
      }
    }

    for (const childId of childrenOf.get(nodeId) ?? []) {
      await walk(childId);
    }
  }

  for (const trigger of triggers) {
    for (const childId of childrenOf.get(trigger.id) ?? []) {
      await walk(childId);
    }
  }

  return context;
}
