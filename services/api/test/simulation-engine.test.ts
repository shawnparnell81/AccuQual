import { describe, expect, it } from "vitest";
import { runSimulation, type TwinModel } from "../src/modules/digital-twin/simulation-engine.js";

describe("simulation-engine", () => {
  const model: TwinModel = {
    nodes: [
      { id: "m1", name: "Stamping Press", type: "machine", baseDefectRate: 0.01, throughputPerHour: 120 },
      { id: "m2", name: "Weld Cell", type: "machine", baseDefectRate: 0.2, throughputPerHour: 60 },
    ],
    edges: [{ from: "m1", to: "m2" }],
  };

  it("produces a risk heatmap entry per node", () => {
    const result = runSimulation(model, { iterations: 200 });
    expect(result.riskHeatmap).toHaveLength(2);
    expect(result.riskHeatmap.map((r) => r.nodeId)).toEqual(["m1", "m2"]);
  });

  it("flags the highest-utilization node as the bottleneck", () => {
    const result = runSimulation(model, { iterations: 50, demandPerHour: 90 });
    // m2's throughput (60/hr) saturates at 90/hr demand (150%->capped 100%); m1 (120/hr) sits at 75%
    expect(result.bottleneck?.nodeId).toBe("m2");
    expect(result.bottleneck?.utilizationPct).toBe(100);
  });

  it("recommends investigating nodes whose simulated defect risk is elevated", () => {
    const result = runSimulation(model, { iterations: 500, driftFactor: 5 });
    expect(result.recommendedActions.some((a) => a.includes("m2"))).toBe(true);
  });
});
