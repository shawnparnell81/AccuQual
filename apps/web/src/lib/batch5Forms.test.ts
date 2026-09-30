import assert from "node:assert/strict";
import test from "node:test";
import { ISO_FORMS } from "./isoFormCatalog";
import {
  BATCH5_SHEET_TITLE,
  blankBatch5,
  evaluateAirCompressorDev,
  evaluateAirStrutDev,
  evaluateElectricLiftDev,
  evaluateFuelInjectorDev,
  injectorDeviationFill,
} from "./batch5Reports";

test("batch F development documents stay separate from validation forms", () => {
  assert.equal(BATCH5_SHEET_TITLE.dev_air_compressor, "AIR COMPRESSOR DEVELOPMENT DOCUMENT");
  assert.equal(BATCH5_SHEET_TITLE.dev_fuel_injector, "FUEL INJECTOR DEVELOPMENT DOCUMENT");
  assert.equal(BATCH5_SHEET_TITLE.dev_electric_lift, "ELECTRIC LIFT SUPPORT DEVELOPMENT DOCUMENT");
  assert.equal(BATCH5_SHEET_TITLE.dev_air_strut, "AIR STRUT DEVELOPMENT DOCUMENT");
  assert.equal(BATCH5_SHEET_TITLE.dev_brake_wear, "BRAKE WEAR SENSOR DEVELOPMENT DOCUMENT");
  assert.equal(BATCH5_SHEET_TITLE.dev_electronic_shock, "ELECTRONIC SHOCK ABSORBER DEVELOPMENT DOCUMENT");
  assert.equal(ISO_FORMS.find((form) => form.formKey === "frm-dev-006")?.formType, "dev_air_strut");
  assert.equal(ISO_FORMS.find((form) => form.formType === "air_strut"), undefined);
  assert.equal(ISO_FORMS.find((form) => form.formType === "air_compressor"), undefined);
  assert.equal(blankBatch5("dev_air_strut").F2, "Maxwell Tollefson");
  assert.equal(blankBatch5("dev_air_strut").B9, "Shawn Parnell");
  assert.equal(blankBatch5("dev_brake_wear").B8, "Shawn Parnell");
  for (const key of ["frm-dev-006", "frm-dev-007", "frm-dev-008", "frm-dev-009", "frm-dev-010", "frm-dev-011"]) {
    assert.equal(ISO_FORMS.find((form) => form.formKey === key)?.formId, "");
  }
});

test("air compressor development averages fill time and converts CFM", () => {
  const cells = blankBatch5("dev_air_compressor");
  assert.equal(evaluateAirCompressorDev(cells).B30, "#DIV/0!");
  cells.B27 = 10;
  cells.B28 = 12;
  cells.B29 = 14;
  const result = evaluateAirCompressorDev(cells);
  assert.equal(result.B30, 12);
  const expected = ((100 / 14.7) * (0.5 / 7.48) / 12) * 60;
  assert.ok(Math.abs(Number(result.B31) - expected) < 1e-9);
});

test("fuel injector development matches TREND, SLOPE, and the 5 percent limit", () => {
  const cells = blankBatch5("dev_fuel_injector");
  cells.B30 = 6000;
  cells.B31 = 8000;
  cells.B32 = 5000;
  cells.B33 = 6000;
  cells.B34 = 7000;
  cells.B36 = 50;
  const result = evaluateFuelInjectorDev(cells);
  assert.equal(result.C30, 1);
  assert.ok(Math.abs(Number(result.C34) - 7 / 3) < 1e-9);
  assert.ok(Math.abs(Number(result.D30) - 1) < 1e-9);
  assert.equal(result.B37, 100);
  assert.ok(Math.abs(Number(result.B38)) < 1e-9);
  assert.ok(Math.abs(Number(result.B39) - 1 / 3) < 1e-9);
  assert.ok(Math.abs(Number(result.B40) - 20000) < 1e-6);
  assert.equal(injectorDeviationFill(0), "#00B050");
  assert.equal(injectorDeviationFill(0.05), "#FF0000");
});

test("electric lift development spring rate uses stroke minus 20", () => {
  const cells = blankBatch5("dev_electric_lift");
  cells.B41 = 100;
  cells.B42 = 200;
  cells.B14 = 120;
  assert.equal(evaluateElectricLiftDev(cells).B44, 1);
  cells.B14 = 20;
  assert.equal(evaluateElectricLiftDev(cells).B44, "#DIV/0!");
});

test("air strut development interpolates ride height from 20 and 40 PSI", () => {
  const cells = blankBatch5("dev_air_strut");
  assert.equal(evaluateAirStrutDev(cells).B26, "#DIV/0!");
  cells.B8 = 4000;
  cells.D8 = 50;
  cells.F8 = 1;
  cells.B24 = 1000;
  cells.B25 = 2000;
  cells.C24 = 10;
  cells.C25 = 30;
  const result = evaluateAirStrutDev(cells);
  assert.equal(result.B26, 4450);
  assert.equal(result.B27, 89);
  assert.equal(result.B28, 79);
});
