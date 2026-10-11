import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultPlantView, moveChart, objectiveReading, pinChart, summaryFor, targetFor, toggleChart, unpinChart, type KpiChartDef, type KpiObjective, type KpiPlant } from "./kpiView.ts";

const plants: KpiPlant[] = [
  { id: 1, name: "Greer", token: "greer" },
  { id: 2, name: "Wellman", token: "wellman" },
];

function objective(patch: Partial<KpiObjective>): KpiObjective {
  return {
    id: "obj",
    name: "CAPA",
    metric: "capa_on_time",
    plantScope: "all",
    target: 90,
    direction: "higher",
    amberThreshold: 80,
    ownerId: 1,
    ownerName: "Shawn Parnell",
    reviewFrequency: "monthly",
    active: true,
    notes: "",
    updatedAt: "2026-10-10T16:00:00.000Z",
    periodLabel: "2026-10",
    readings: {
      all: { actual: 92, status: "green", percentOfTarget: 102.2 },
      byPlant: { "1": { actual: 70, status: "red", percentOfTarget: 77.8 } },
    },
    ...patch,
  };
}

const chart: KpiChartDef = { id: "capa_on_time", area: "CAPA", label: "CAPAs closed on time", metricId: "capa_on_time", compareMetricId: null };

describe("kpi view", () => {
  it("follows the top-bar plant until the page picks one", () => {
    assert.equal(defaultPlantView(plants, "all", 1), "all");
    assert.equal(defaultPlantView(plants, null, 1), 1);
    assert.equal(defaultPlantView(plants, null, 99), "all");
  });

  it("counts on-target objectives for the plant on screen", () => {
    const rows = [objective({}), objective({ id: "aged", metric: "ncr_open_over_30", readings: { all: { actual: 9, status: "red", percentOfTarget: 55 }, byPlant: {} } })];
    assert.deepEqual(summaryFor(rows, "all", plants), { onTarget: 1, active: 2 });
    assert.equal(objectiveReading(rows[0]!, 1, plants).status, "red");
  });

  it("pins, unpins, moves, and finds the target for the selected plant", () => {
    assert.deepEqual(pinChart(["capa_on_time"], "complaints"), ["capa_on_time", "complaints"]);
    assert.deepEqual(pinChart(["capa_on_time"], "capa_on_time"), ["capa_on_time"]);
    assert.deepEqual(unpinChart(["capa_on_time", "complaints"], "capa_on_time"), ["complaints"]);
    assert.deepEqual(moveChart(["a", "b", "c"], "c", -1), ["a", "c", "b"]);
    assert.deepEqual(toggleChart(["a"], "a"), []);
    assert.equal(targetFor(chart, [objective({})], "all", plants), 90);
    assert.equal(targetFor({ ...chart, compareMetricId: "ncrs_closed" }, [objective({})], "all", plants), null);
  });
});
