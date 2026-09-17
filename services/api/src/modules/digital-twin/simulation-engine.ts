/**
 * Digital Twin simulation engine.
 *
 * A model is a JSON graph of machines/processes/material flow. `runSimulation`
 * runs a lightweight Monte Carlo pass over the model's defect-rate parameters
 * to estimate predicted defect rates, bottlenecks, and a per-node risk heatmap.
 * A production build would swap this for a proper discrete-event simulator;
 * this keeps the same input/output contract so it's a drop-in replacement.
 *
 * Defect propagation: each simulated unit walks the graph in topological
 * order (respecting `edges`), and a unit already defective when it arrives
 * at a node stays defective through every node downstream of it — a real
 * manufacturing defect introduced upstream isn't "fixed" by a later step
 * merely because that step has its own low defect rate. A node's own
 * `baseDefectRate` only ever ADDS new defects on top of whatever a unit
 * already carries in; it was previously computed in complete isolation
 * from `edges`, so a downstream node's risk score never reflected an
 * elevated-risk node feeding into it.
 */

export interface TwinNode {
  id: string;
  name: string;
  type: "machine" | "process" | "checkpoint" | "operator";
  baseDefectRate?: number; // 0-1
  throughputPerHour?: number;
}

export interface TwinModel {
  nodes: TwinNode[];
  edges: Array<{ from: string; to: string }>;
}

export interface SimulationParameters {
  iterations?: number;
  demandPerHour?: number;
  driftFactor?: number; // multiplies baseDefectRate to simulate process drift
}

export interface SimulationResult {
  predictedDefectRatePct: number;
  bottleneck: { nodeId: string; utilizationPct: number } | null;
  riskHeatmap: Array<{ nodeId: string; riskScore: number }>;
  recommendedActions: string[];
}

/**
 * Kahn's algorithm. Edges referencing a node id not present in `model.nodes`
 * are ignored rather than throwing — the same forgiving treatment the
 * bottleneck/heatmap logic below already gives a malformed model. A real
 * cycle (a modeling error a manufacturing line graph shouldn't have) can't
 * be topologically ordered at all; rather than crash the simulation over
 * it, whatever's left ungraphed after the pass is appended in the model's
 * own original order so every node still gets simulated, just without a
 * meaningful upstream/downstream relationship for the nodes on that cycle.
 */
function topologicalOrder(model: TwinModel): TwinNode[] {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, string[]>();
  const inDegree = new Map<string, number>(model.nodes.map((n) => [n.id, 0]));

  for (const edge of model.edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const queue = model.nodes.filter((n) => inDegree.get(n.id) === 0);
  const remaining = new Map(inDegree);
  const order: TwinNode[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const nextId of outgoing.get(node.id) ?? []) {
      const next = (remaining.get(nextId) ?? 1) - 1;
      remaining.set(nextId, next);
      if (next === 0) {
        const nextNode = byId.get(nextId);
        if (nextNode) queue.push(nextNode);
      }
    }
  }

  if (order.length < model.nodes.length) {
    const seen = new Set(order.map((n) => n.id));
    for (const node of model.nodes) if (!seen.has(node.id)) order.push(node);
  }

  return order;
}

export function runSimulation(model: TwinModel, params: SimulationParameters = {}): SimulationResult {
  const iterations = params.iterations ?? 1000;
  const demandPerHour = params.demandPerHour ?? 100;
  const driftFactor = params.driftFactor ?? 1;

  const order = topologicalOrder(model);
  const predecessors = new Map<string, string[]>();
  for (const edge of model.edges) {
    if (!predecessors.has(edge.to)) predecessors.set(edge.to, []);
    predecessors.get(edge.to)!.push(edge.from);
  }

  const defectCounts = new Map<string, number>(model.nodes.map((n) => [n.id, 0]));

  for (let unit = 0; unit < iterations; unit++) {
    // Whether THIS simulated unit is already defective by the time it
    // leaves each node — reset per unit, carried forward node-to-node
    // within this one pass through the line.
    const isDefectiveAt = new Map<string, boolean>();
    for (const node of order) {
      const preds = predecessors.get(node.id) ?? [];
      // Multiple predecessors means merging flows (e.g. a sub-assembly
      // joining the main line) — a defect on ANY incoming path carries
      // through the merge; it isn't diluted by also merging with a good one.
      const arrivedDefective = preds.some((id) => isDefectiveAt.get(id));
      const ownRate = (node.baseDefectRate ?? 0.01) * driftFactor;
      const defective = arrivedDefective || monteCarloTrial(ownRate);
      isDefectiveAt.set(node.id, defective);
      if (defective) defectCounts.set(node.id, (defectCounts.get(node.id) ?? 0) + 1);
    }
  }

  const riskHeatmap = model.nodes.map((node) => ({
    nodeId: node.id,
    riskScore: Math.round(((defectCounts.get(node.id) ?? 0) / iterations) * 10000) / 100,
  }));

  const predictedDefectRatePct =
    riskHeatmap.length === 0 ? 0 : Math.round((riskHeatmap.reduce((sum, r) => sum + r.riskScore, 0) / riskHeatmap.length) * 100) / 100;

  const bottleneckNode = model.nodes
    .filter((n) => n.throughputPerHour)
    .map((n) => ({ nodeId: n.id, utilizationPct: Math.min(100, Math.round((demandPerHour / (n.throughputPerHour ?? 1)) * 100)) }))
    .sort((a, b) => b.utilizationPct - a.utilizationPct)[0];

  const recommendedActions: string[] = [];
  if (bottleneckNode && bottleneckNode.utilizationPct > 90) {
    recommendedActions.push(`Increase capacity at node ${bottleneckNode.nodeId} — utilization above 90%`);
  }
  const highRiskNodes = riskHeatmap.filter((r) => r.riskScore > 5);
  for (const r of highRiskNodes) {
    recommendedActions.push(`Investigate elevated defect risk at node ${r.nodeId} (${r.riskScore}%)`);
  }

  return { predictedDefectRatePct, bottleneck: bottleneckNode ?? null, riskHeatmap, recommendedActions };
}

function monteCarloTrial(probability: number): boolean {
  return Math.random() < probability;
}
