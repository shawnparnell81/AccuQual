import assert from "node:assert/strict";
import test from "node:test";
import { ECR_LABEL_DEFAULTS } from "./ecrTemplate";
import { ecrCellLocked, ecrStatusLabel } from "./ecrWorkflow";
import { ISO_FORMS } from "./isoFormCatalog";

test("ECR master is Rev B and the impact section is on the sheet", () => {
  assert.equal(ISO_FORMS.find((form) => form.formKey === "frm-ecr-001")?.rev, "B");
  assert.equal(ECR_LABEL_DEFAULTS.section7, "SECTION 7: LINKS, TRAINING, AND IMPACT");
  assert.equal(ECR_LABEL_DEFAULTS.partNumbers, "Part Number(s) Affected:");
  assert.equal(ecrStatusLabel("review"), "In review");
});

test("cell locks follow the stage", () => {
  assert.equal(ecrCellLocked("all", true, "B6"), false);
  assert.equal(ecrCellLocked("all", false, "B6"), true);
  assert.equal(ecrCellLocked("none", true, "B31"), true);
  assert.equal(ecrCellLocked("implementation", true, "B6"), true);
  assert.equal(ecrCellLocked("implementation", true, "B31"), false);
  assert.equal(ecrCellLocked("implementation", true, "D31"), false);
  assert.equal(ecrCellLocked("implementation", true, "F31"), false);
});
