import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyStepSaveError,
  eightDNextLabel,
  eightDStepIsSaved,
  missingEightDFields,
  percentTotalHint,
  percentTotalIsComplete,
} from "./eightDProgress.ts";

test("D8 is saved once the report moves past step 8, and the 100% hint hides at 100", () => {
  assert.equal(eightDStepIsSaved(8, 8), false);
  assert.equal(eightDStepIsSaved(8, 9), true);
  assert.equal(eightDNextLabel(8), "D8");
  assert.equal(eightDNextLabel(9), null);
  assert.equal(percentTotalIsComplete("100"), true);
  assert.equal(percentTotalIsComplete("100%"), true);
  assert.equal(percentTotalIsComplete("40% + 60%"), true);
  assert.equal(percentTotalIsComplete("50, 50"), true);
  assert.equal(percentTotalIsComplete("80"), false);
  assert.equal(percentTotalHint("100"), null);
  assert.equal(percentTotalHint("80"), "(must have 100% total)");
  assert.equal(percentTotalHint(""), "(must have 100% total)");
});

test("a failed step save names the empty fields, and a PIN error asks for the signature", () => {
  const missing = missingEightDFields(8, { recognition: "  " });
  assert.deepEqual(missing, ["D8 Recognition"]);
  const notice = classifyStepSaveError("Couldn't save", missing);
  assert.equal(notice.kind, "validation");
  assert.match(notice.summary, /D8 Recognition/);
  const signed = classifyStepSaveError("A signature PIN is required before this step can be certified.");
  assert.equal(signed.kind, "signature");
  assert.equal(classifyStepSaveError("That PIN is not correct.").kind, "signature");
  assert.deepEqual(missingEightDFields(4, { rootCauses: "tool wear", rootCausePercentContribution: "100" }), []);
  assert.deepEqual(missingEightDFields(5, { pca: "new fixture", pcaPercentEffective: "100%" }), []);
});
