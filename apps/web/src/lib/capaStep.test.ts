import assert from "node:assert/strict";
import test from "node:test";
import { capaStepFieldEditable, textStillDirty } from "./capaStep.ts";

test("the current CAPA step is editable without Edit, including whether the fix worked", () => {
  assert.equal(capaStepFieldEditable("open", "rootCause", true), true);
  assert.equal(capaStepFieldEditable("open", "verification", true), false);
  assert.equal(capaStepFieldEditable("in_progress", "verification", true), true);
  assert.equal(capaStepFieldEditable("in_progress", "actionPlan", true), true);
  assert.equal(capaStepFieldEditable("in_progress", "rootCause", true), false);
  assert.equal(capaStepFieldEditable("verifying", "verification", true), true);
  assert.equal(capaStepFieldEditable("closed", "verification", true), false);
  assert.equal(capaStepFieldEditable("in_progress", "verification", false), false);
});

test("a saved rich-text value is not still dirty after Save", () => {
  assert.equal(textStillDirty("Checked the lot", "Checked the lot"), false);
  assert.equal(textStillDirty("Checked the lot", "Checked the lot\n"), false);
  assert.equal(textStillDirty("Checked the lot", "Checked the next lot"), true);
});
