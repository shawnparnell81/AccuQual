import type { Edge, Node } from "@xyflow/react";
import { GitBranch, Play, Plug, ShieldCheck, Split, Square, Zap, type LucideIcon } from "lucide-react";

export type WfNodeType = "trigger" | "condition" | "action" | "integration" | "approval" | "parallel" | "end";

export interface WfNode {
  id: string;
  type: WfNodeType;
  kind: string;
  label?: string;
  config: Record<string, unknown>;
  position?: { x: number; y: number };
}
export interface WfEdge {
  from: string;
  to: string;
  branch?: string;
  label?: string;
}
export interface WfMetadata {
  name?: string;
  description?: string;
  category?: string;
  module?: string;
  allowLoops?: boolean;
  [key: string]: unknown;
}
export interface WfPayload {
  nodes: WfNode[];
  edges: WfEdge[];
  metadata?: WfMetadata;
}

export interface NodeMeta {
  type: WfNodeType;
  title: string;
  hint: string;
  icon: LucideIcon;
  /** Tailwind classes for the node's accent (border + icon tint). */
  accent: string;
  defaultKind: string;
  /** Named exits: a condition has true/false, an approval approved/rejected. */
  exits?: { id: string; label: string }[];
}

export const NODE_META: Record<WfNodeType, NodeMeta> = {
  trigger: { type: "trigger", title: "Trigger", hint: "The event that starts a run", icon: Play, accent: "border-primary text-primary", defaultKind: "closed" },
  condition: {
    type: "condition",
    title: "Condition",
    hint: "Routes on a field of the event",
    icon: GitBranch,
    accent: "border-warning text-warning",
    defaultKind: "condition",
    exits: [
      { id: "true", label: "true" },
      { id: "false", label: "false" },
    ],
  },
  action: { type: "action", title: "Action", hint: "Assign, create an NCR, escalate…", icon: Zap, accent: "border-success text-success", defaultKind: "assign_user" },
  integration: { type: "integration", title: "Integration", hint: "Email, notification, ERP sync", icon: Plug, accent: "border-accent-foreground text-accent-foreground", defaultKind: "send_email" },
  approval: {
    type: "approval",
    title: "Approval",
    hint: "Pauses until a person decides",
    icon: ShieldCheck,
    accent: "border-primary text-primary",
    defaultKind: "approval",
    exits: [
      { id: "approved", label: "approved" },
      { id: "rejected", label: "rejected" },
    ],
  },
  parallel: { type: "parallel", title: "Parallel", hint: "Splits into several branches", icon: Split, accent: "border-muted-foreground text-muted-foreground", defaultKind: "fork" },
  end: { type: "end", title: "End", hint: "Ends this branch", icon: Square, accent: "border-destructive text-destructive", defaultKind: "end" },
};

export const NODE_ORDER: WfNodeType[] = ["trigger", "condition", "action", "integration", "approval", "parallel", "end"];
export const INTEGRATION_KINDS = ["send_email", "notify_department", "notify_supplier", "erp_sync"];

export interface NodeData extends Record<string, unknown> {
  node: WfNode;
  issueCount: number;
}
export type CanvasNode = Node<NodeData, "wf">;
export type CanvasEdge = Edge<{ branch?: string; label?: string }>;

export const edgeId = (from: string, to: string, branch?: string) => `${from}->${to}[${branch ?? ""}]`;

/**
 * Nodes saved before the canvas existed have no position. Lay them out left to right by depth from the triggers so an
 * old workflow opens readable rather than in a heap.
 */
function autoLayout(nodes: WfNode[], edges: WfEdge[]): Map<string, { x: number; y: number }> {
  const depth = new Map<string, number>();
  const queue = nodes.filter((n) => n.type === "trigger").map((n) => n.id);
  queue.forEach((id) => depth.set(id, 0));
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of edges) {
      if (e.from === id && !depth.has(e.to)) {
        depth.set(e.to, depth.get(id)! + 1);
        queue.push(e.to);
      }
    }
  }
  const columns = new Map<number, number>();
  const out = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    const row = columns.get(d) ?? 0;
    columns.set(d, row + 1);
    out.set(n.id, { x: 40 + d * 280, y: 40 + row * 130 });
  }
  return out;
}

export function fromPayload(payload: WfPayload | undefined): { nodes: CanvasNode[]; edges: CanvasEdge[]; metadata: WfMetadata } {
  const nodes = payload?.nodes ?? [];
  const edges = payload?.edges ?? [];
  const layout = nodes.some((n) => !n.position) ? autoLayout(nodes, edges) : null;
  return {
    nodes: nodes.map((n) => ({ id: n.id, type: "wf" as const, position: n.position ?? layout!.get(n.id) ?? { x: 0, y: 0 }, data: { node: { ...n, config: n.config ?? {} }, issueCount: 0 } })),
    edges: edges.map((e) => ({
      id: edgeId(e.from, e.to, e.branch),
      source: e.from,
      target: e.to,
      sourceHandle: e.branch || "out",
      label: e.branch || e.label || undefined,
      data: { branch: e.branch, label: e.label },
    })),
    metadata: payload?.metadata ?? {},
  };
}

export function toPayload(nodes: CanvasNode[], edges: CanvasEdge[], metadata: WfMetadata): WfPayload {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.node.type,
      kind: n.data.node.kind,
      ...(n.data.node.label ? { label: n.data.node.label } : {}),
      config: n.data.node.config,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    })),
    edges: edges.map((e) => ({ from: e.source, to: e.target, ...(e.data?.branch ? { branch: e.data.branch } : {}), ...(e.data?.label ? { label: e.data.label } : {}) })),
    metadata,
  };
}

let counter = 0;
/** A fresh node id that cannot collide with what is already on the canvas. */
export function newNodeId(existing: CanvasNode[]): string {
  const used = new Set(existing.map((n) => n.id));
  let id: string;
  do id = `n${Date.now().toString(36)}${(counter++).toString(36)}`;
  while (used.has(id));
  return id;
}
