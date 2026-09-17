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

describe("simulation-engine — defect propagation", () => {
  it("a downstream node inherits an always-defective upstream node's risk, even with its own baseDefectRate at 0", () => {
    const chain: TwinModel = {
      nodes: [
        { id: "a", name: "A", type: "machine", baseDefectRate: 1 }, // always fails
        { id: "b", name: "B", type: "machine", baseDefectRate: 0 }, // never fails on its own
        { id: "c", name: "C", type: "machine", baseDefectRate: 0 },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    };

    const result = runSimulation(chain, { iterations: 200 });
    const byId = Object.fromEntries(result.riskHeatmap.map((r) => [r.nodeId, r.riskScore]));
    expect(byId.a).toBe(100);
    expect(byId.b).toBe(100); // inherited from a, not just b's own 0% rate
    expect(byId.c).toBe(100); // inherited transitively through b
  });

  it("a node with no predecessors and a 0 baseDefectRate reports ~0 risk (no false propagation)", () => {
    const isolated: TwinModel = {
      nodes: [{ id: "solo", name: "Solo", type: "machine", baseDefectRate: 0 }],
      edges: [],
    };
    const result = runSimulation(isolated, { iterations: 200 });
    expect(result.riskHeatmap[0]?.riskScore).toBe(0);
  });

  it("a merge node inherits a defect from EITHER upstream branch, not just one", () => {
    const merge: TwinModel = {
      nodes: [
        { id: "good", name: "Good branch", type: "machine", baseDefectRate: 0 },
        { id: "bad", name: "Bad branch", type: "machine", baseDefectRate: 1 }, // always fails
        { id: "assembly", name: "Assembly", type: "machine", baseDefectRate: 0 },
      ],
      edges: [
        { from: "good", to: "assembly" },
        { from: "bad", to: "assembly" },
      ],
    };
    const result = runSimulation(merge, { iterations: 200 });
    const byId = Object.fromEntries(result.riskHeatmap.map((r) => [r.nodeId, r.riskScore]));
    expect(byId.assembly).toBe(100); // the "bad" branch's defect always carries through the merge
  });

  it("ignores an edge referencing a node id that doesn't exist, without crashing", () => {
    const malformed: TwinModel = {
      nodes: [{ id: "a", name: "A", type: "machine", baseDefectRate: 0.5 }],
      edges: [{ from: "a", to: "does-not-exist" }],
    };
    expect(() => runSimulation(malformed, { iterations: 50 })).not.toThrow();
  });
});
