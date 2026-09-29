import assert from "node:assert/strict";
import test from "node:test";
import { gageEvaluationFill, systemEvaluationFor } from "../components/forms/customForms/gageRRMath";
import { pswLayout, qualityAlertLayout, turtleLayout } from "./qualitySheetLayouts";
import { canEditFormNumber, sheetRevision } from "./formDocument";
import { faiFill, faiResult, formatRatio, lowerBetterFill, lowerIsBetter, nbhFill, pcaFill, plusDays, sumNumbers, vocFill } from "./qualitySheetLogic";

test("first article pass/fail uses nominal and tolerance", () => {
  assert.equal(faiResult(10, 0.1, 10.05), "Pass");
  assert.equal(faiResult(10, 0.1, 10.2), "Fail");
  assert.equal(faiResult(10, "±0.20", 9.85), "Pass");
  assert.equal(faiResult(10, "+0.10/-0.05", 9.94), "Fail");
  assert.equal(faiResult(10, "+0.10/-0.05", 9.96), "Pass");
  assert.equal(faiResult(10, "9.5-10.5", 9.5), "Pass");
  assert.equal(faiResult("", "0.1", 10), "");
  assert.equal(faiResult(10, "", 10), "");
  assert.equal(faiFill("Pass"), "fill-green");
  assert.equal(faiFill("Fail"), "fill-red");
  assert.equal(faiFill(""), "");
});

test("quality alert closing date is 30 days after the issue date", () => {
  assert.equal(plusDays("2026-01-01", 30), "2026-01-31");
  assert.equal(plusDays("2026-01-15", 30), "2026-02-14");
  assert.equal(plusDays("2024-02-01", 30), "2024-03-02");
  assert.equal(plusDays("", 30), null);
  assert.equal(plusDays("2026-02-31", 30), null);
});

test("customer scorecard achievement matches the sheet formulas", () => {
  assert.equal(lowerIsBetter(8.69, 7.5), 7.5 / 8.69);
  assert.equal(lowerIsBetter(0, 3.53), 1);
  assert.equal(lowerIsBetter(5, 12, "global-nct"), 1);
  assert.equal(lowerIsBetter(15, 12, "global-nct"), 15 / 12);
  assert.equal(lowerIsBetter(4, 4), 1);
  assert.equal(lowerIsBetter(null, 4), null);
  assert.equal(formatRatio(1), "100%");
  assert.equal(formatRatio(7.5 / 8.69), "86%");
  assert.equal(lowerBetterFill(0, 6), "fill-green");
  assert.equal(lowerBetterFill(9.98, 17.6), "fill-green");
  assert.equal(lowerBetterFill(27.96, 8.16), "fill-red");
  assert.equal(vocFill("G"), "fill-green");
  assert.equal(vocFill("Y"), "fill-yellow");
  assert.equal(vocFill("R"), "fill-red");
  assert.equal(nbhFill("N"), "fill-green");
  assert.equal(nbhFill("Y"), "fill-red");
});

test("failure chart totals sum the month grid and highlight an implemented action", () => {
  assert.equal(sumNumbers(["1", "", "2", null, 4]), 7);
  assert.equal(sumNumbers(["", null]), null);
  assert.equal(pcaFill("Yes"), "fill-gray");
  assert.equal(pcaFill("Not implemented"), "");
  assert.equal(pcaFill("N/A"), "");
});

test("gage evaluation bands follow the sheet thresholds", () => {
  assert.equal(systemEvaluationFor(10.9), "system O.K.");
  assert.equal(systemEvaluationFor(11), "conditionally acceptable system");
  assert.equal(systemEvaluationFor(29.9), "conditionally acceptable system");
  assert.equal(systemEvaluationFor(30), "unacceptable system");
  assert.equal(gageEvaluationFill("system O.K."), "fill-green");
  assert.equal(gageEvaluationFill("conditionally acceptable system"), "fill-yellow");
  assert.equal(gageEvaluationFill("unacceptable system"), "fill-red");
});

test("new sheet layouts keep their titles and do not invent a document number", () => {
  assert.equal(pswLayout().rows[1]?.[0]?.text, "PART SUBMISSION WARRANT");
  assert.equal(pswLayout().rows[2]?.[0]?.text, "Rev: A");
  assert.equal(pswLayout().rows.flat().some((cell) => /FRM-/.test(cell.text ?? "")), false);
  assert.equal(turtleLayout().rows[1]?.[0]?.text, "TURTLE DIAGRAM");
  assert.equal(turtleLayout().rows[2]?.[0]?.text, "Rev: A");
  assert.equal(turtleLayout().rows.flat().some((cell) => /FRM-/.test(cell.text ?? "")), false);
  assert.equal(turtleLayout().rows[8]?.[0]?.text, "Context");
  assert.equal(turtleLayout().rows[22]?.[0]?.text, "Finance");
  assert.equal(qualityAlertLayout().rows[1]?.[0]?.text, "QUALITY ALERT");
  assert.equal(qualityAlertLayout().rows.flat().some((cell) => /FRM-/.test(cell.text ?? "")), false);
  assert.equal(qualityAlertLayout().rows.find((row) => row?.some((cell) => cell.addr === "D3"))?.[3]?.kind, "calc");
  const nok = qualityAlertLayout().rows.flat().find((cell) => cell.text === "NOK");
  const ok = qualityAlertLayout().rows.flat().find((cell) => cell.text === "OK");
  assert.equal(nok?.paint, "fill-red");
  assert.equal(ok?.paint, "fill-green");
});

test("a filled copy prints its stored document number and stays blank when it has none", () => {
  assert.equal(sheetRevision(""), "Rev: A");
  assert.equal(sheetRevision("   "), "Rev: A");
  assert.equal(sheetRevision("QA-14"), "Doc ID: QA-14 · Rev: A");
});

test("engineering, quality managers, and administrators can change a form number", () => {
  assert.equal(canEditFormNumber({ roleName: "admin", department: "production" }), true);
  assert.equal(canEditFormNumber({ roleName: "owner", department: null }), true);
  assert.equal(canEditFormNumber({ roleName: "quality_manager", department: "production" }), true);
  assert.equal(canEditFormNumber({ roleName: "operator", department: "engineering" }), true);
  assert.equal(canEditFormNumber({ roleName: "operator", department: "quality" }), false);
  assert.equal(canEditFormNumber({ roleName: "lead", department: "production" }), false);
  assert.equal(canEditFormNumber(null), false);
});
