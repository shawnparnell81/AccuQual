import assert from "node:assert/strict";
import test from "node:test";
import { VALIDATION_FORMS, formTypeOf } from "./validationReport";
import {
  BATCH3_SHEET_TITLE,
  blankCoil,
  blankCompressor,
  blankElectric,
  blankGas,
  blankShock,
  evaluateCoil,
  evaluateCompressor,
  evaluateElectric,
  evaluateGas,
  evaluateShock,
  overallCoil,
  overallCompressor,
  overallElectric,
  overallGas,
  overallShock,
} from "./batch3Reports";

test("third-batch titles stay separate from conflicting Doc IDs", () => {
  assert.equal(BATCH3_SHEET_TITLE.shock, "SHOCK VALIDATION REPORT");
  assert.equal(BATCH3_SHEET_TITLE.air_compressor, "AIR COMPRESSOR VALIDATION DOCUMENT");
  assert.equal(BATCH3_SHEET_TITLE.electric_lift, "ELECTRIC LIFT SUPPORT VALIDATION DOCUMENT");
  assert.equal(BATCH3_SHEET_TITLE.gas_lift, "GAS LIFT SUPPORT VALIDATION DOCUMENT");
  assert.equal(BATCH3_SHEET_TITLE.coil_spring, "COIL SPRING VALIDATION DOCUMENT");
  assert.equal(VALIDATION_FORMS.air_compressor.title, "FRM-VAL-003 AIR COMPRESSOR VALIDATION DOCUMENT");
  assert.equal(VALIDATION_FORMS.gas_lift.title, "FRM-VAL-005 GAS LIFT SUPPORT VALIDATION DOCUMENT");
  assert.equal(VALIDATION_FORMS.electric_lift.title, "FRM-VAL-004 ELECTRIC LIFT SUPPORT VALIDATION DOCUMENT");
  assert.equal(VALIDATION_FORMS.air_strut.title, "FRM-VAL-010 AIR STRUT VALIDATION DOCUMENT");
  assert.equal(VALIDATION_FORMS.air_spring.title, "FRM-VAL-011 AIR STRUT VALIDATION DOCUMENT");
  assert.equal(VALIDATION_FORMS.electric_lift.formKey, "frm-val-004");
  assert.equal(VALIDATION_FORMS.gas_lift.formKey, "frm-val-005");
  assert.notEqual(formTypeOf({ formType: "gas_lift" }), "fuel_pump");
  assert.notEqual(formTypeOf({ formType: "electric_lift" }), "air_spring");
  assert.equal(VALIDATION_FORMS.shock.formKey === VALIDATION_FORMS.air_compressor.formKey, false);
  for (const title of Object.values(BATCH3_SHEET_TITLE)) assert.equal(title.includes("FRM-VAL"), false);
});

test("shock grade and band follow the workbook", () => {
  assert.equal(blankShock().F5, "Shawn Parnell");
  assert.equal(overallShock(blankShock()), "Failed");
  const cells = blankShock();
  cells.E11 = 10;
  cells.F11 = 10;
  cells.C15 = 100;
  cells.D15 = 7;
  cells.E15 = 100;
  cells.F15 = 100;
  cells.C17 = 40;
  cells.D17 = 5;
  cells.E17 = 40;
  cells.F17 = 40;
  cells.D16 = 7;
  cells.E16 = 60;
  cells.F16 = 60;
  cells.C18 = 25;
  cells.E18 = 30;
  cells.F18 = 25;
  for (const row of [24, 29, 35, 36, 37, 38]) {
    cells[`C${row}`] = 10;
    cells[`D${row}`] = 1;
    cells[`E${row}`] = 10;
    cells[`F${row}`] = 10;
  }
  const result = evaluateShock(cells);
  assert.equal(result.C16, 60);
  assert.equal(result.G11, "Passed");
  assert.equal(result.G18, "Passed");
  assert.equal(result.A3, "Passed");
  cells.E11 = 9;
  assert.equal(evaluateShock(cells).G11, "Failed");
  assert.equal(overallShock(cells), "Failed");
});

test("air compressor scores spec, tolerance, and actual", () => {
  assert.equal(overallCompressor(blankCompressor()), "FAIL");
  const cells = blankCompressor();
  for (const row of [12, 13, 14, 15, 16, 17, 18, 19, 23, 24, 25, 26, 27, 32, 33, 34, 35, 36, 37, 38, 42, 43]) {
    cells[`B${row}`] = 10;
    cells[`C${row}`] = 1;
    cells[`D${row}`] = 10.5;
  }
  assert.equal(evaluateCompressor(cells).E13, "Pass");
  assert.equal(overallCompressor(cells), "PASS");
  cells.D13 = 12;
  assert.equal(evaluateCompressor(cells).E13, "Fail");
  assert.equal(overallCompressor(cells), "FAIL");
});

test("electric lift uses the workbook comparisons", () => {
  const cells = blankElectric();
  assert.equal(blankElectric().B8, "Shawn Parnell");
  cells.C14 = 1;
  cells.D14 = 1.1;
  assert.equal(evaluateElectric(cells).E14, "Pass");
  cells.D14 = 2;
  assert.equal(evaluateElectric(cells).E14, "Fail");
  cells.C37 = 10;
  cells.D37 = 12;
  assert.equal(evaluateElectric(cells).E37, "Passed");
  cells.D37 = 9;
  assert.equal(evaluateElectric(cells).E37, "Fail");
  cells.C27 = "Yes";
  cells.D27 = "Yes";
  assert.equal(evaluateElectric(cells).E27, "Pass");
  assert.equal(overallElectric(blankElectric()), "Fail");
});

test("gas lift is not the fuel pump sheet", () => {
  const cells = blankGas();
  cells.B13 = "NA";
  assert.equal(evaluateGas(cells).H13, "Pass");
  cells.B25 = 100;
  cells.C25 = "Y";
  cells.G25 = 90;
  const open = evaluateGas(cells);
  assert.equal(open.E25, 85);
  assert.equal(open.F25, 99999);
  assert.equal(open.H25, "Pass");
  cells.G25 = 80;
  assert.equal(evaluateGas(cells).H25, "Fail");
  cells.G28 = "Y";
  assert.equal(evaluateGas(cells).H28, "Pass");
  cells.G28 = "N";
  assert.equal(evaluateGas(cells).H28, "Fail");
  const blank = evaluateGas(blankGas());
  assert.equal(blank.B40, blank.J2);
  assert.equal(overallGas(blankGas()), "Fail");
});

test("coil spring averages samples and scores Wahl stress", () => {
  const cells = blankCoil();
  cells.B12 = 5;
  cells.E12 = 5;
  cells.F12 = 5;
  cells.G12 = 5;
  cells.B13 = 20;
  cells.E13 = 20;
  cells.F13 = 20;
  cells.G13 = 20;
  cells.B25 = 1;
  const pass = evaluateCoil(cells);
  assert.equal(pass.H12, 5);
  assert.equal(pass.I12, "PASS");
  assert.equal(pass.C32, "X");
  assert.equal(pass.G32, "PASS");
  cells.B14 = "Pigtail";
  cells.E14 = "Tangential";
  assert.equal(evaluateCoil(cells).I14, "FALSE");
  cells.E14 = "Pigtail";
  assert.equal(evaluateCoil(cells).I14, "PASS");
  cells.B25 = 500;
  assert.equal(evaluateCoil(cells).G32, "FAIL");
  assert.equal(overallCoil(cells), "FAIL");
});
