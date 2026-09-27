import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FORMULAS, materializeRow } from "./formulas.ts";
import { fmeaLayout } from "./layouts/fmea.ts";
import type { TableBlock } from "./layouts/types.ts";
import {
  FMEA_PRIORITY_LEGEND,
  PFMEA_ACTION_PRIORITY_TABLE,
  RPN_THRESHOLDS,
  fmeaCellValue,
  fmeaComputedTone,
  pfmeaActionPriority,
  rpnTone,
  type ActionPriority,
} from "./fmeaPriority.ts";

/** Representative and boundary cells from the AIAG-VDA 2019 PFMEA Action Priority table. */
const CASES: readonly (readonly [number, number, number, ActionPriority])[] = [
  // Severity 9-10
  [10, 10, 10, "H"],
  [10, 8, 1, "H"],
  [9, 6, 2, "H"],
  [9, 7, 1, "H"],
  [9, 5, 2, "H"],
  [9, 4, 1, "M"],
  [10, 5, 1, "M"],
  [9, 3, 7, "H"],
  [9, 2, 6, "M"],
  [9, 2, 5, "M"],
  [9, 3, 4, "L"],
  [9, 2, 2, "L"],
  [10, 3, 1, "L"],
  [10, 1, 10, "L"],
  [9, 1, 1, "L"],
  // Severity 7-8
  [8, 10, 1, "H"],
  [7, 8, 2, "H"],
  [8, 6, 2, "H"],
  [8, 7, 1, "M"],
  [7, 4, 7, "H"],
  [7, 5, 6, "M"],
  [8, 4, 2, "M"],
  [7, 4, 1, "M"],
  [8, 2, 7, "M"],
  [7, 3, 5, "M"],
  [8, 2, 4, "L"],
  [7, 3, 1, "L"],
  [8, 1, 10, "L"],
  // Severity 4-6
  [6, 10, 7, "H"],
  [4, 8, 5, "H"],
  [6, 9, 4, "M"],
  [5, 8, 2, "M"],
  [6, 8, 1, "M"],
  [6, 6, 7, "M"],
  [5, 7, 2, "M"],
  [4, 6, 1, "L"],
  [6, 4, 7, "M"],
  [5, 5, 6, "L"],
  [4, 4, 1, "L"],
  [6, 2, 10, "L"],
  [4, 1, 1, "L"],
  // Severity 2-3
  [3, 10, 7, "M"],
  [2, 8, 5, "M"],
  [3, 10, 4, "L"],
  [2, 8, 1, "L"],
  [3, 6, 10, "L"],
  [2, 4, 7, "L"],
  [3, 2, 1, "L"],
  [2, 1, 10, "L"],
  // Severity 1
  [1, 10, 10, "L"],
  [1, 1, 1, "L"],
  [1, 5, 8, "L"],
];

function failureModes(): TableBlock {
  const block = fmeaLayout.sections[1]!.blocks[0];
  if (block?.type !== "table") throw new Error("failure mode table missing");
  return block;
}

describe("PFMEA Action Priority table", () => {
  it("covers every severity, occurrence, and detection from 1 to 10 exactly once", () => {
    for (let s = 1; s <= 10; s++) {
      for (let o = 1; o <= 10; o++) {
        for (let d = 1; d <= 10; d++) {
          const hits = PFMEA_ACTION_PRIORITY_TABLE.filter(
            (rule) =>
              s >= rule.severity[0] &&
              s <= rule.severity[1] &&
              o >= rule.occurrence[0] &&
              o <= rule.occurrence[1] &&
              d >= rule.detection[0] &&
              d <= rule.detection[1],
          );
          assert.equal(hits.length, 1, `S${s} O${o} D${d} matched ${hits.length} rules`);
          const ap = pfmeaActionPriority(s, o, d);
          assert.equal(ap, hits[0]!.ap);
          assert.ok(ap === "H" || ap === "M" || ap === "L");
        }
      }
    }
  });

  it("matches the published representative and edge rows", () => {
    for (const [s, o, d, expected] of CASES) {
      assert.equal(pfmeaActionPriority(s, o, d), expected, `S${s} O${o} D${d}`);
    }
  });

  it("stays blank when a rating is missing or outside 1-10", () => {
    assert.equal(pfmeaActionPriority("", 5, 5), "");
    assert.equal(pfmeaActionPriority(5, null, 5), "");
    assert.equal(pfmeaActionPriority(5, 5, undefined), "");
    assert.equal(pfmeaActionPriority(0, 5, 5), "");
    assert.equal(pfmeaActionPriority(11, 5, 5), "");
    assert.equal(pfmeaActionPriority(5.5, 5, 5), "");
    assert.equal(pfmeaActionPriority("8", "3", "5"), "M");
  });
});

describe("R.P.N. bands", () => {
  it("uses one threshold pair: 200 high, 100 medium, below 100 low", () => {
    assert.equal(RPN_THRESHOLDS.highMin, 200);
    assert.equal(RPN_THRESHOLDS.mediumMin, 100);
    assert.equal(rpnTone(199), "medium");
    assert.equal(rpnTone(200), "high");
    assert.equal(rpnTone(100), "medium");
    assert.equal(rpnTone(99), "low");
    assert.equal(rpnTone(0), "low");
    assert.equal(rpnTone(1000), "high");
    assert.equal(rpnTone("120"), "medium");
    assert.equal(rpnTone(""), null);
    assert.equal(rpnTone(null), null);
    assert.equal(rpnTone("n/a"), null);
  });

  it("colors only the R.P.N. and AP formulas", () => {
    assert.equal(fmeaComputedTone("rpn", 240), "high");
    assert.equal(fmeaComputedTone("rpnRevised", 140), "medium");
    assert.equal(fmeaComputedTone("actionPriority", "H"), "high");
    assert.equal(fmeaComputedTone("actionPriorityRevised", "M"), "medium");
    assert.equal(fmeaComputedTone("actionPriority", "L"), "low");
    assert.equal(fmeaComputedTone("calibrationStatus", "Current"), null);
    assert.equal(fmeaComputedTone("yieldPercent", 50), null);
  });
});

describe("FMEA form columns", () => {
  it("keeps the existing keys and inserts AP beside each R.P.N.", () => {
    assert.deepEqual(
      failureModes().columns.map((column) => column.key),
      [
        "processStep",
        "potentialFailureMode",
        "potentialEffects",
        "severity",
        "class",
        "potentialCauses",
        "occurrence",
        "controlsPrevention",
        "controlsDetection",
        "detection",
        "rpn",
        "ap",
        "recommendedActions",
        "responsibilityTargetDate",
        "actionsTaken",
        "severityRevised",
        "occurrenceRevised",
        "detectionRevised",
        "rpnRevised",
        "apRevised",
      ],
    );
    assert.equal(failureModes().columns.find((column) => column.key === "ap")?.formula, "actionPriority");
    assert.equal(failureModes().columns.find((column) => column.key === "apRevised")?.formula, "actionPriorityRevised");
    assert.equal(failureModes().legend, FMEA_PRIORITY_LEGEND);
  });

  it("computes AP on an older saved row that has no AP keys", () => {
    const saved = {
      processStep: "Weld",
      severity: 10,
      occurrence: 8,
      detection: 7,
      rpn: 560,
      recommendedActions: "Add a poke yoke",
      severityRevised: 9,
      occurrenceRevised: 2,
      detectionRevised: 2,
    };
    const next = materializeRow(saved, failureModes().columns);
    assert.equal(next.processStep, "Weld");
    assert.equal(next.rpn, 560);
    assert.equal(next.recommendedActions, "Add a poke yoke");
    assert.equal(next.ap, "H");
    assert.equal(next.rpnRevised, 36);
    assert.equal(next.apRevised, "L");
    assert.equal(FORMULAS.actionPriority!(saved), "H");
    assert.equal(FORMULAS.actionPriorityRevised!(saved), "L");
    assert.equal(fmeaCellValue("actionPriority", saved, undefined), "H");
    assert.equal(fmeaCellValue("actionPriority", { ...saved, ap: "H" }, "H"), "H");
  });
});
