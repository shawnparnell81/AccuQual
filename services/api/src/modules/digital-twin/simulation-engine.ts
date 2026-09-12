/**
 * Digital Twin simulation engine.
 *
 * A model is a JSON graph of machines/processes/material flow. `runSimulation`
 * runs a lightweight Monte Carlo pass over the model's defect-rate parameters
 * to estimate predicted defect rates, bottlenecks, and a per-node risk heatmap.
 * A production build would swap this for a proper discrete-event simulator;
 * this keeps the same input/output contract so it's a drop-in replacement.
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

export function runSimulation(model: TwinModel, params: SimulationParameters = {}): SimulationResult {
  const iterations = params.iterations ?? 1000;
  const demandPerHour = params.demandPerHour ?? 100;
  const driftFactor = params.driftFactor ?? 1;

  const riskHeatmap = model.nodes.map((node) => {
    const rate = (node.baseDefectRate ?? 0.01) * driftFactor;
    let defects = 0;
    for (let i = 0; i < iterations; i++) {
      if (monteCarloTrial(rate)) defects++;
    }
    return { nodeId: node.id, riskScore: Math.round((defects / iterations) * 10000) / 100 };
  });

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
