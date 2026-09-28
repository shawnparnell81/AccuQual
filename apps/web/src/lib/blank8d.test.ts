import assert from "node:assert/strict";
import test from "node:test";
import { BLANK_8D_LABELS, blank8dFromData, previousFields } from "./blank8d";

test("Blank 8D labels match the owner's sheet", () => {
  assert.equal(BLANK_8D_LABELS.d5, "D5  Choose and Verify Permenant Corrective Action(s) (PCA):");
  assert.equal(BLANK_8D_LABELS.d6, "D6 Implement and Validate Permentant Corrective Action(s) (PCA):");
  assert.equal(BLANK_8D_LABELS.mistakeProofing, "Mistake Proofing:  How are you going to ensure it can't happen again?");
  assert.equal(BLANK_8D_LABELS.initiatorSupervisor, "8D Initiator's Spvr:");
  assert.equal(BLANK_8D_LABELS.internalAudit, "Add to Internal Audit");
});

test("older problem text fills the problem statement and D1 stays in previous fields", () => {
  const shown = blank8dFromData({ d1_team: "The team", d2_problem: "One defect" });
  assert.equal(shown.problemStatement, "One defect");
  assert.equal(shown.teamMembers, "");
  const earlier = previousFields({ d1_team: "The team", d2_problem: "One defect" });
  assert.equal(earlier.length, 1);
  assert.equal(earlier[0]?.label, "D1 — Establish the Team");
});
