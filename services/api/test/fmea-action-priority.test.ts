import { describe, expect, it } from "vitest";
import { fmeaLayout } from "../src/modules/forms/layouts/fmea.js";
import { renderFormLayoutAsPdf } from "../src/modules/forms/schema-pdf-renderer.js";
import {
  FMEA_PDF_TONE,
  FMEA_PRIORITY_LEGEND,
  PFMEA_ACTION_PRIORITY_TABLE,
  RPN_THRESHOLDS,
  fmeaCellValue,
  fmeaComputedTone,
  pfmeaActionPriority,
  rpnTone,
  type ActionPriority,
} from "../src/modules/forms/fmeaPriority.js";
import type { TableBlock } from "../src/modules/forms/layouts/types.js";

const CASES: readonly (readonly [number, number, number, ActionPriority])[] = [
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
  [3, 10, 7, "M"],
  [2, 8, 5, "M"],
  [3, 10, 4, "L"],
  [2, 8, 1, "L"],
  [3, 6, 10, "L"],
  [2, 4, 7, "L"],
  [3, 2, 1, "L"],
  [2, 1, 10, "L"],
  [1, 10, 10, "L"],
  [1, 1, 1, "L"],
  [1, 5, 8, "L"],
];

function failureModes(): TableBlock {
  const block = fmeaLayout.sections[1]!.blocks[0];
  if (!block || block.type !== "table") throw new Error("failure mode table missing");
  return block;
}

describe("PFMEA Action Priority", () => {
  it("covers every 1-10 severity, occurrence, and detection exactly once", () => {
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
          expect(hits).toHaveLength(1);
          expect(pfmeaActionPriority(s, o, d)).toBe(hits[0]!.ap);
        }
      }
    }
  });

  it("matches the published representative and edge rows", () => {
    for (const [s, o, d, expected] of CASES) {
      expect(pfmeaActionPriority(s, o, d), `S${s} O${o} D${d}`).toBe(expected);
    }
  });

  it("stays blank outside the 1-10 scales", () => {
    expect(pfmeaActionPriority("", 5, 5)).toBe("");
    expect(pfmeaActionPriority(0, 8, 8)).toBe("");
    expect(pfmeaActionPriority(11, 2, 2)).toBe("");
    expect(pfmeaActionPriority(8, 3, 5)).toBe("M");
  });

  it("bands R.P.N. at 200 and 100", () => {
    expect(RPN_THRESHOLDS).toEqual({ highMin: 200, mediumMin: 100 });
    expect(rpnTone(200)).toBe("high");
    expect(rpnTone(199)).toBe("medium");
    expect(rpnTone(100)).toBe("medium");
    expect(rpnTone(99)).toBe("low");
    expect(rpnTone("")).toBeNull();
    expect(fmeaComputedTone("rpn", 560)).toBe("high");
    expect(fmeaComputedTone("rpnRevised", 36)).toBe("low");
    expect(fmeaComputedTone("actionPriority", "H")).toBe("high");
    expect(fmeaComputedTone("actionPriorityRevised", "L")).toBe("low");
    expect(FMEA_PDF_TONE.high.bg[0]).toBeGreaterThan(FMEA_PDF_TONE.high.bg[1]);
    expect(FMEA_PDF_TONE.low.bg[1]).toBeGreaterThan(FMEA_PDF_TONE.low.bg[0]);
  });

  it("keeps existing column keys and places AP next to each R.P.N.", () => {
    expect(failureModes().columns.map((column) => column.key)).toEqual([
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
    ]);
    expect(failureModes().legend).toBe(FMEA_PRIORITY_LEGEND);
  });

  it("fills a missing AP from S/O/D for an older saved row and still prints a PDF", async () => {
    const row = { severity: 10, occurrence: 8, detection: 7, rpn: 560, severityRevised: 2, occurrenceRevised: 2, detectionRevised: 2, rpnRevised: 8 };
    expect(fmeaCellValue("actionPriority", row, undefined)).toBe("H");
    expect(fmeaCellValue("actionPriorityRevised", row, "")).toBe("L");
    expect(fmeaCellValue("rpn", row, 560)).toBe(560);

    const bytes = await renderFormLayoutAsPdf(fmeaLayout, {
      fmeaNumber: "FMEA-1",
      failureModes: [
        { ...row, processStep: "Weld", potentialFailureMode: "Crack", ap: "H", apRevised: "L" },
        { processStep: "Paint", severity: 6, occurrence: 5, detection: 4, rpn: 120 },
        { processStep: "Pack", severity: 2, occurrence: 3, detection: 2, rpn: 12 },
      ],
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString("ascii")).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
