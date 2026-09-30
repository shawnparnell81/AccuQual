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

test("published ISO letters stay on the masters", () => {
  const rev = Object.fromEntries(ISO_FORMS.map((form) => [form.formType, form.rev]));
  assert.equal(rev.ncr_report, "C");
  assert.equal(rev.internal_audit, "A");
  assert.equal(ISO_FORMS.every((form) => form.formId === ""), true);
});
