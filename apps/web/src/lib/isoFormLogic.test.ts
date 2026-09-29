import assert from "node:assert/strict";
import test from "node:test";
import { auditLayout, EXCLUSIVE_CHECKS, ncrLayout, quarantineLayout } from "./isoFormLayouts";
import { crossTrainingScores, quarantineTotal, resultFill } from "./isoFormLogic";

test("quarantine total adds the five quantity cells", () => {
  assert.equal(quarantineTotal({ B17: 2, B18: "3", B19: "", B20: 1, B21: null }), 6);
  assert.equal(quarantineTotal({}), null);
});

test("cross-training multiplies each base score by its weight", () => {
  const scores = crossTrainingScores({ S1: 10, S2: 8, S3: 5, S4: 9, S5: 7, S6: 6 });
  assert.equal(scores.lines.S1, 20);
  assert.equal(scores.lines.S2, 16);
  assert.equal(scores.lines.S3, 5);
  assert.equal(scores.sections.A, 41);
  assert.equal(scores.sections.B, 18);
  assert.equal(scores.sections.C, 14);
  assert.equal(scores.sections.D, 6);
  assert.equal(scores.total, 79);
  assert.equal(crossTrainingScores({ S1: 11 }).lines.S1, null);
});

test("audit results use pass, minor, and major colors", () => {
  assert.equal(resultFill("Pass"), "fill-green");
  assert.equal(resultFill("Minor NC"), "fill-yellow");
  assert.equal(resultFill("Major NC"), "fill-red");
  assert.equal(resultFill(""), "");
});

test("each workbook keeps its title and the quarantine total cell", () => {
  assert.equal(auditLayout().rows[1]?.[0]?.text, "INTERNAL AUDIT CHECKLIST");
  assert.equal(ncrLayout().rows[1]?.[0]?.text, "NON-CONFORMANCE REPORT (NCR)");
  assert.equal(ncrLayout().rows.flat().find((cell) => cell?.addr === "B22")?.text, "USE AS-IS");
  const withConcession = ncrLayout().rows.flat().find((cell) => cell?.text === "with concession");
  const noConcession = ncrLayout().rows.flat().find((cell) => cell?.text === "no concession");
  assert.equal(withConcession?.kind, "check");
  assert.equal(withConcession?.enableWhen, "B22");
  assert.equal(noConcession?.addr, "F22");
  assert.equal(noConcession?.enableWhen, "B22");
  assert.ok(EXCLUSIVE_CHECKS.ncr_report?.some((group) => group.includes("B22") && group.includes("C22") && !group.includes("E22")));
  assert.ok(EXCLUSIVE_CHECKS.ncr_report?.some((group) => group.includes("E22") && group.includes("F22") && !group.includes("B22")));
  assert.equal(ncrLayout().rows.flat().find((cell) => cell?.addr === "A23")?.text, "Chargeback Cost?");
  assert.equal(quarantineLayout().rows[22]?.find((cell) => cell.addr === "B22")?.kind, "calc");
  assert.equal(auditLayout().rows[6]?.find((cell) => cell.addr === "F6")?.kind, "select");
});
