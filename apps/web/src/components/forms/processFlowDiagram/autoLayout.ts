import type { DiagramEdge, DiagramNodePosition, DiagramState } from "./diagramTypes";

const LAYER_SPACING_X = 220;
const LANE_SPACING_Y = 140;
const START_X = 120;
const START_Y = 100;

/**
 * Layered (Sugiyama-style) auto-layout, built on the same Kahn's-algorithm
 * pattern as the Digital Twin's `simulation-engine.ts` topologicalOrder —
 * same "forgiving" cycle handling (a dangling edge is ignored; a node a
 * cycle prevents from being ordered is appended past the deepest placed
 * layer rather than throwing).
 *
 * Manual-override policy (incremental fill-only): every node whose stored
 * entry is absent or `manual: false` gets a freshly computed position on
 * every call — for today's common zero-branch case this reproduces the
 * exact positions already assigned (layer/lane order is unchanged), so in
 * effect only a newly-added node's position changes. A `manual: true`
 * node's own position is left untouched, but it still anchors its
 * neighbors' barycenter sort.
 */
export function computeAutoLayout(nodeIds: string[], edges: DiagramEdge[], diagram: DiagramState): DiagramState {
  const idSet = new Set(nodeIds);
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    if (!idSet.has(e.from) || !idSet.has(e.to)) continue;
    outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e.to]);
    incoming.set(e.to, [...(incoming.get(e.to) ?? []), e.from]);
  }

  const inDegree = new Map<string, number>(nodeIds.map((id) => [id, (incoming.get(id) ?? []).length]));
  const layer = new Map<string, number>();
  const queue: string[] = nodeIds.filter((id) => (inDegree.get(id) ?? 0) === 0);
  for (const id of queue) layer.set(id, 0);
  const remaining = new Map(inDegree);
  const ordered: string[] = [];
  let qi = 0;
  while (qi < queue.length) {
    const id = queue[qi++]!;
    ordered.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const left = (remaining.get(next) ?? 1) - 1;
      remaining.set(next, left);
      const candidateLayer = (layer.get(id) ?? 0) + 1;
      layer.set(next, Math.max(layer.get(next) ?? 0, candidateLayer));
      if (left === 0) queue.push(next);
    }
  }
  if (ordered.length < nodeIds.length) {
    const seen = new Set(ordered);
    const fallbackLayer = Math.max(0, ...Array.from(layer.values())) + 1;
    for (const id of nodeIds) {
      if (!seen.has(id)) {
        layer.set(id, fallbackLayer);
        ordered.push(id);
      }
    }
  }

  const byLayer = new Map<number, string[]>();
  for (const id of nodeIds) {
    const l = layer.get(id) ?? 0;
    byLayer.set(l, [...(byLayer.get(l) ?? []), id]);
  }

  const nextNodes: Record<string, DiagramNodePosition> = {};
  const maxLayer = Math.max(0, ...Array.from(byLayer.keys()));
  for (let l = 0; l <= maxLayer; l++) {
    const idsInLayer = byLayer.get(l) ?? [];
    const withBarycenter = idsInLayer.map((id, i) => {
      const preds = incoming.get(id) ?? [];
      const placedPredYs = preds.map((p) => nextNodes[p]?.y).filter((y): y is number => y !== undefined);
      const barycenter = placedPredYs.length > 0 ? placedPredYs.reduce((a, b) => a + b, 0) / placedPredYs.length : Number.POSITIVE_INFINITY;
      return { id, i, barycenter };
    });
    withBarycenter.sort((a, b) => (a.barycenter === b.barycenter ? a.i - b.i : a.barycenter - b.barycenter));

    let laneIndex = 0;
    for (const { id } of withBarycenter) {
      const existing = diagram.nodes[id];
      if (existing?.manual) {
        nextNodes[id] = existing;
        continue;
      }
      nextNodes[id] = { x: START_X + l * LAYER_SPACING_X, y: START_Y + laneIndex * LANE_SPACING_Y, manual: false };
      laneIndex++;
    }
  }

  return { version: 1, nodes: nextNodes, edges, lastAutoLayoutAt: new Date().toISOString() };
}
