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

export type ActionHandler = (node: WorkflowNode, context: Record<string, unknown>) => Promise<void> | void;

const actionRegistry: Record<string, ActionHandler> = {
  assign_user: async (node, context) => {
    context.actionsRun = [...((context.actionsRun as unknown[]) ?? []), { kind: "assign_user", node: node.id }];
  },
  create_capa: async (node, context) => {
    context.actionsRun = [...((context.actionsRun as unknown[]) ?? []), { kind: "create_capa", node: node.id }];
  },
  send_email: async (node, context) => {
    context.actionsRun = [...((context.actionsRun as unknown[]) ?? []), { kind: "send_email", node: node.id }];
  },
};

export function registerActionHandler(kind: string, handler: ActionHandler) {
  actionRegistry[kind] = handler;
}

function evaluateCondition(node: WorkflowNode, context: Record<string, unknown>): boolean {
  const { field, equals, greaterThan } = node.config as { field?: string; equals?: unknown; greaterThan?: number };
  if (!field) return true;
  const value = context[field];
  if (equals !== undefined) return value === equals;
  if (greaterThan !== undefined) return typeof value === "number" && value > greaterThan;
  return true;
}

export async function runWorkflow(
  definition: WorkflowDefinition,
  context: Record<string, unknown>,
  triggerKind?: string
): Promise<Record<string, unknown>> {
  const nodesById = new Map(definition.nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, string[]>();
  for (const edge of definition.edges) {
    childrenOf.set(edge.from, [...(childrenOf.get(edge.from) ?? []), edge.to]);
  }

  const triggers = definition.nodes.filter((n) => n.type === "trigger" && (!triggerKind || n.kind === triggerKind));

  async function walk(nodeId: string) {
    const node = nodesById.get(nodeId);
    if (!node) return;

    if (node.type === "condition" && !evaluateCondition(node, context)) {
      return; // short-circuit this branch
    }

    if (node.type === "action") {
      const handler = actionRegistry[node.kind];
      if (handler) await handler(node, context);
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
