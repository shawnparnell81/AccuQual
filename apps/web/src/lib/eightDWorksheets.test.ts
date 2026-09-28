import assert from "node:assert/strict";
import test from "node:test";
import { computeWorksheets, emptyWorksheets, formatThousands, worksheetsFromReport } from "./eightDWorksheets";

test("a new report starts with the workbook's theory numbers and choice titles", () => {
  const sheets = emptyWorksheets();
  assert.equal(sheets.problemSolvingWorksheetD4.L10, "1");
  assert.equal(sheets.problemSolvingWorksheetD4.L18, "7");
  assert.equal(sheets.decisionMaking.G9, "A");
  assert.equal(sheets.decisionMaking.P9, "D");
  assert.deepEqual(worksheetsFromReport({}).problemDescriptionD2, {});
  assert.equal(worksheetsFromReport({ problemSolvingWorksheetD4: { L10: "tool wear" } }).problemSolvingWorksheetD4.L10, "tool wear");
});

test("problem description and the solving worksheet follow the workbook formulas", () => {
  const sheets = emptyWorksheets();
  sheets.problemDescriptionD2 = { E9: "Housing", F9: "Cover", G9: "Drawing", E21: "Rising" };
  const computed = computeWorksheets(sheets, { eightDNo: "42", problemStatement: "Holes oversized" });
  assert.equal(computed.problemDescriptionD2.C3, "42");
  assert.equal(computed.problemDescriptionD2.E5, "Holes oversized");
  assert.equal(computed.problemSolvingWorksheetD4.C3, "42");
  assert.equal(computed.problemSolvingWorksheetD4.F5, "Holes oversized");
  assert.equal(computed.problemSolvingWorksheetD4.E10, "Housing");
  assert.equal(computed.problemSolvingWorksheetD4.F10, "Cover");
  assert.equal(computed.problemSolvingWorksheetD4.E22, "Rising");
  assert.equal(computed.testingPossibleCausesD4.E11, "1");
  assert.equal(computed.testingPossibleCausesD4.K11, "7");
  assert.equal(computed.riskAnalysis.C3, "42");
  assert.equal(computed.planProblemPrevention.C5, "42");
});

test("decision scores multiply importance by how good, then total", () => {
  const sheets = emptyWorksheets();
  sheets.decisionMaking = {
    ...sheets.decisionMaking,
    E23: "10",
    H23: "8",
    K23: "4",
    E24: "5",
    H24: "2",
    K24: "10",
    H25: "x",
    E25: "2",
  };
  const computed = computeWorksheets(sheets, { eightDNo: "7", problemStatement: "" });
  assert.equal(computed.decisionMaking.I23, "80");
  assert.equal(computed.decisionMaking.L23, "40");
  assert.equal(computed.decisionMaking.I24, "10");
  assert.equal(computed.decisionMaking.L24, "50");
  assert.equal(computed.decisionMaking.I25, "#VALUE!");
  assert.equal(computed.decisionMaking.E34, "17");
  assert.equal(computed.decisionMaking.H34, "#VALUE!");

  sheets.decisionMaking.E25 = "0";
  sheets.decisionMaking.H25 = "0";
  const clean = computeWorksheets(sheets, { eightDNo: "7", problemStatement: "" });
  assert.equal(clean.decisionMaking.I25, "0");
  assert.equal(clean.decisionMaking.E34, "15");
  assert.equal(clean.decisionMaking.H34, "90");
  assert.equal(clean.decisionMaking.K34, "90");
  assert.equal(clean.decisionMaking.E35, formatThousands(15000));
  assert.equal(clean.decisionMaking.E35, "15,000");
});

test("changing a theory updates the testing header", () => {
  const sheets = emptyWorksheets();
  sheets.problemSolvingWorksheetD4.L13 = "Worn die";
  const computed = computeWorksheets(sheets, { eightDNo: "3", problemStatement: "Burr" });
  assert.equal(computed.testingPossibleCausesD4.G11, "Worn die");
  assert.equal(computed.testingPossibleCausesD4.C9, "3");
});
