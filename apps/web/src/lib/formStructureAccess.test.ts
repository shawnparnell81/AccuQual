import assert from "node:assert/strict";
import test from "node:test";
import { canEditFormStructure } from "./formStructureAccess";
import { blankCells as airBlank } from "./airStrutReport";
import { buildAirStrutRows } from "./airStrutSheet";
import { blankCells as fuelBlank } from "./fuelPumpReport";
import { buildFuelPumpRows } from "./fuelPumpSheet";
import { ISO_FORMS } from "./isoFormCatalog";
import { blankCells as csaBlank } from "./validationReport";
import { buildSheetRows } from "./validationReportSheet";

const ALLOWED = [
  "owner",
  "admin",
  "quality_manager",
  "vice_president",
  "Quality Manager",
  "Engineering Manager",
  "Engineer",
  "Engineers",
  "Quality",
  "Product Engineer",
  "VP of Quality and Engineering",
];

const DENIED = ["operator", "staff", "lead", "director", "president", "auditor", "supplier", "VP of Operations", "Quality Inspector"];

test("structure edits stay open to quality and engineering titles", () => {
  for (const roleName of ALLOWED) assert.equal(canEditFormStructure({ roleName }), true, roleName);
  for (const roleName of DENIED) assert.equal(canEditFormStructure({ roleName }), false, roleName);
  assert.equal(canEditFormStructure(null), false);
});

test("validation masters do not print a form number until one is set, and new fills name Shawn Parnell", () => {
  const csa = buildSheetRows().flat().map((cell) => cell.text ?? "").join("\n");
  const fuel = buildFuelPumpRows().flat().map((cell) => cell.text ?? "").join("\n");
  const air = buildAirStrutRows().flat().map((cell) => cell?.text ?? "").join("\n");
  assert.equal(/FRM-VAL-/.test(csa), false);
  assert.equal(/FRM-VAL-/.test(fuel), false);
  assert.equal(/FRM-VAL-/.test(air), false);
  assert.match(csa, /CSA VALIDATION REPORT/);
  assert.match(fuel, /FUEL PUMP VALIDATION DOCUMENT/);
  assert.match(air, /AIR STRUT VALIDATION DOCUMENT/);
  assert.equal(csaBlank().B8, "Shawn Parnell");
  assert.equal(fuelBlank().B8, "Shawn Parnell");
  assert.equal(airBlank().B8, "Shawn Parnell");
});

test("published ISO letters and source Doc IDs stay on the masters", () => {
  const rev = Object.fromEntries(ISO_FORMS.map((form) => [form.formType, form.rev]));
  const id = Object.fromEntries(ISO_FORMS.map((form) => [form.formKey, form.formId]));
  const title = Object.fromEntries(ISO_FORMS.map((form) => [form.formKey, form.title]));
  assert.equal(rev.ncr_report, undefined);
  assert.equal(rev.internal_audit, "A");
  assert.equal(title["frm-gen-001"], "AUDIT CHECKLIST");
  assert.equal(id["frm-trn-001"], "FRM-TRN-001");
  assert.equal(title["frm-trn-001"], "COMPETENCY AND TRAINING RECORD");
  assert.equal(id["frm-trn-002"], "FRM-TRN-002");
  assert.equal(title["frm-trn-002"], "GRADING RUBRIC: CROSS-TRAINING EVALUATION");
  assert.equal(id["frm-ncr-001"], undefined);
  assert.equal(title["frm-ncr-001"], undefined);
  assert.equal(id["frm-gen-002"], "");
  assert.equal(title["frm-gen-002"], "INTERNAL AUDIT SUMMARY REPORT");
  assert.equal(id["frm-tst-001"], "");
  assert.equal(id["frm-tst-002"], "");
  assert.equal(title["frm-tst-001"], "ASTM E542 Gravimetric Volume Calculator");
  assert.equal(title["frm-tst-002"], "ASTM E542 Gravimetric Volume Calculator");
});
