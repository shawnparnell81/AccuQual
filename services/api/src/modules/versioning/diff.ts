import type { FormLayout } from "../forms/layouts/types.js";

export type DiffChange = "added" | "removed" | "changed";
export type DiffScope = "node" | "transition" | "metadata" | "field" | "row";

export interface DiffEntry {
  change: DiffChange;
  scope: DiffScope;
  /** Stable identifier: a node id, "from->to", a metadata key, or a form field/cell path. */
  key: string;
  /** Human-readable name for the UI. */
  label: string;
  from?: unknown;
  to?: unknown;
  /** For a changed node or transition: which of its properties differ. */
  details?: { field: string; from: unknown; to: unknown }[];
}

export interface DiffResult {
  entries: DiffEntry[];
  summary: { added: number; removed: number; changed: number };
}

function summarize(entries: DiffEntry[]): DiffResult {
  return {
    entries,
    summary: {
      added: entries.filter((e) => e.change === "added").length,
      removed: entries.filter((e) => e.change === "removed").length,
      changed: entries.filter((e) => e.change === "changed").length,
    },
  };
}

/** Deep equality for the JSON-shaped values a payload can hold (key order never matters). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) if (!jsonEqual(ao[k], bo[k])) return false;
  return true;
}

/** Empty values are treated as "nothing there", so `undefined`, `null` and `""` never show up as spurious changes. */
function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

// ---- Workflows ---------------------------------------------------------------------------------------------------------------------------------

export interface WorkflowPayloadNode {
  id: string;
  type: string;
  kind: string;
  label?: string;
  config?: Record<string, unknown>;
  position?: { x: number; y: number };
}
export interface WorkflowPayloadEdge {
  from: string;
  to: string;
  branch?: string;
  label?: string;
}
export interface WorkflowPayload {
  nodes: WorkflowPayloadNode[];
  edges: WorkflowPayloadEdge[];
  metadata?: Record<string, unknown>;
}

export const edgeKey = (e: WorkflowPayloadEdge) => `${e.from}->${e.to}${e.branch ? `[${e.branch}]` : ""}`;

function describeNode(n: WorkflowPayloadNode): string {
  return `${n.label ? `${n.label} — ` : ""}${n.type}: ${n.kind}`;
}

/**
 * Node-, transition- and metadata-level diff between two workflow versions.
 * Where a node sits on the canvas is deliberately not compared: dragging a box
 * around is not a change to what the workflow does, and would bury real
 * changes in noise.
 */
export function diffWorkflowVersions(before: WorkflowPayload, after: WorkflowPayload): DiffResult {
  const entries: DiffEntry[] = [];

  const beforeNodes = new Map((before.nodes ?? []).map((n) => [n.id, n]));
  const afterNodes = new Map((after.nodes ?? []).map((n) => [n.id, n]));
  for (const [id, n] of afterNodes) {
    const old = beforeNodes.get(id);
    if (!old) {
      entries.push({ change: "added", scope: "node", key: id, label: describeNode(n), to: n });
      continue;
    }
    const details: DiffEntry["details"] = [];
    for (const field of ["type", "kind", "label"] as const) {
      if (!(isBlank(old[field]) && isBlank(n[field])) && old[field] !== n[field]) details.push({ field, from: old[field], to: n[field] });
    }
    const configKeys = new Set([...Object.keys(old.config ?? {}), ...Object.keys(n.config ?? {})]);
    for (const k of configKeys) {
      const a = old.config?.[k];
      const b = n.config?.[k];
      if (!(isBlank(a) && isBlank(b)) && !jsonEqual(a, b)) details.push({ field: `config.${k}`, from: a, to: b });
    }
    if (details.length) entries.push({ change: "changed", scope: "node", key: id, label: describeNode(n), from: old, to: n, details });
  }
  for (const [id, n] of beforeNodes) if (!afterNodes.has(id)) entries.push({ change: "removed", scope: "node", key: id, label: describeNode(n), from: n });

  const beforeEdges = new Map((before.edges ?? []).map((e) => [edgeKey(e), e]));
  const afterEdges = new Map((after.edges ?? []).map((e) => [edgeKey(e), e]));
  const nameOf = (id: string) => afterNodes.get(id)?.label ?? beforeNodes.get(id)?.label ?? id;
  for (const [key, e] of afterEdges) {
    const old = beforeEdges.get(key);
    const label = `${nameOf(e.from)} → ${nameOf(e.to)}${e.branch ? ` (${e.branch})` : ""}`;
    if (!old) entries.push({ change: "added", scope: "transition", key, label, to: e });
    else if (!(isBlank(old.label) && isBlank(e.label)) && old.label !== e.label) entries.push({ change: "changed", scope: "transition", key, label, from: old, to: e, details: [{ field: "label", from: old.label, to: e.label }] });
  }
  for (const [key, e] of beforeEdges) if (!afterEdges.has(key)) entries.push({ change: "removed", scope: "transition", key, label: `${nameOf(e.from)} → ${nameOf(e.to)}${e.branch ? ` (${e.branch})` : ""}`, from: e });

  const metaKeys = new Set([...Object.keys(before.metadata ?? {}), ...Object.keys(after.metadata ?? {})]);
  for (const k of metaKeys) {
    const a = before.metadata?.[k];
    const b = after.metadata?.[k];
    if (isBlank(a) && isBlank(b)) continue;
    if (jsonEqual(a, b)) continue;
    entries.push({ change: isBlank(a) ? "added" : isBlank(b) ? "removed" : "changed", scope: "metadata", key: k, label: k, from: a, to: b });
  }
  return summarize(entries);
}

// ---- Documents built on a form layout (Management Review, Context of the Organization) --------------------------------------------------------------------

function cellText(v: unknown): unknown {
  return isBlank(v) ? "" : v;
}

/**
 * Field-level diff between two versions of a layout-driven document. Labels come
 * from the document's own layout, so the reader sees "Chairperson Name" or a
 * table row's real heading, never a raw key.
 */
export function diffFormVersions(layout: FormLayout | undefined, before: Record<string, unknown>, after: Record<string, unknown>): DiffResult {
  const entries: DiffEntry[] = [];
  const push = (key: string, label: string, a: unknown, b: unknown, scope: DiffScope = "field") => {
    const from = cellText(a);
    const to = cellText(b);
    if (jsonEqual(from, to)) return;
    entries.push({ change: from === "" ? "added" : to === "" ? "removed" : "changed", scope, key, label, from: from === "" ? undefined : from, to: to === "" ? undefined : to });
  };

  const seen = new Set<string>();
  for (const section of layout?.sections ?? []) {
    for (const block of section.blocks) {
      if (block.type === "row") {
        for (const f of block.fields) {
          seen.add(f.name);
          push(f.name, f.label.replace(/:$/, ""), before[f.name], after[f.name]);
        }
      } else if (block.type === "textarea" || block.type === "yesno") {
        seen.add(block.name);
        push(block.name, block.label.replace(/:$/, ""), before[block.name], after[block.name]);
      } else if (block.type === "table") {
        seen.add(block.name);
        const a = Array.isArray(before[block.name]) ? (before[block.name] as Record<string, unknown>[]) : [];
        const b = Array.isArray(after[block.name]) ? (after[block.name] as Record<string, unknown>[]) : [];
        const rowCount = Math.max(a.length, b.length);
        for (let i = 0; i < rowCount; i++) {
          const rowLabel = block.fixedRowLabels?.[i] ?? `Row ${i + 1}`;
          const ra = a[i];
          const rb = b[i];
          const rowEmpty = (r?: Record<string, unknown>) => !r || Object.values(r).every(isBlank);
          if (!block.fixedRowLabels && rowEmpty(ra) !== rowEmpty(rb)) {
            entries.push({ change: rowEmpty(ra) ? "added" : "removed", scope: "row", key: `${block.name}.${i}`, label: `${section.title} — ${rowLabel}`, from: rowEmpty(ra) ? undefined : ra, to: rowEmpty(rb) ? undefined : rb });
            continue;
          }
          for (const col of block.columns) {
            push(`${block.name}.${i}.${col.key}`, `${rowLabel} — ${col.label}`, ra?.[col.key], rb?.[col.key], "row");
          }
        }
      }
    }
  }
  // Anything stored that the layout doesn't describe still gets compared, labelled by its key.
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) if (!seen.has(k)) push(k, k, before[k], after[k]);

  return summarize(entries);
}
