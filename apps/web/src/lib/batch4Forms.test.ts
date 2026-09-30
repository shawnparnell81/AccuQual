import assert from "node:assert/strict";
import test from "node:test";
import { ISO_FORMS } from "./isoFormCatalog";
import {
  BATCH4_SHEET_TITLE,
  blankBatch4,
  evaluateAirSpringDev,
  evaluateCsaDev,
  evaluateFuelDev,
  evaluateGasDev,
  evaluateHeptane,
  evaluateWater,
} from "./batch4Reports";

test("development documents stay separate from validation reports", () => {
  assert.equal(BATCH4_SHEET_TITLE.dev_csa, "CSA DEVELOPMENT DOCUMENT");
  assert.equal(BATCH4_SHEET_TITLE.dev_fuel_pump, "FUEL PUMP DEVELOPMENT DOCUMENT");
  assert.equal(BATCH4_SHEET_TITLE.dev_gas_lift, "GAS LIFT SUPPORT DEVELOPMENT DOCUMENT");
  assert.equal(BATCH4_SHEET_TITLE.dev_coil, "COIL SPRING DEVELOPMENT DOCUMENT");
  assert.equal(BATCH4_SHEET_TITLE.dev_air_spring, "AIR SPRING DEVELOPMENT DOCUMENT");
  assert.equal(ISO_FORMS.find((form) => form.formKey === "frm-dev-002")?.title, "FUEL PUMP DEVELOPMENT DOCUMENT");
  assert.equal(ISO_FORMS.find((form) => form.formKey === "frm-dev-002")?.formId, "FRM-DEV-002");
  assert.equal(ISO_FORMS.find((form) => form.formType === "fuel_pump"), undefined);
  assert.equal(ISO_FORMS.filter((form) => form.formType === "concession").length, 1);
  assert.equal(blankBatch4("dev_csa").B10, "Shawn Parnell");
});

test("CSA development target force matches the workbook product", () => {
  const cells = blankBatch4("dev_csa");
  cells.B8 = 4000;
  cells.D8 = 50;
  cells.B9 = 1;
  cells.B33 = 30;
  cells.B24 = 12;
  cells.B27 = 100;
  const result = evaluateCsaDev(cells);
  assert.equal(result.B30, 4450);
  assert.equal(typeof result.B31, "number");
  assert.equal(typeof result.B32, "number");
});

test("fuel pump development converts hertz to liters per hour", () => {
  const cells = blankBatch4("dev_fuel_pump");
  cells.B26 = 10;
  cells.B28 = 2;
  const result = evaluateFuelDev(cells);
  assert.equal(result.C26, 226.44);
  assert.ok(Math.abs(Number(result.C28) - 45.288) < 1e-9);
});

test("gas lift development averages the static forces", () => {
  const cells = blankBatch4("dev_gas_lift");
  assert.equal(evaluateGasDev(cells).B35, "#DIV/0!");
  cells.B31 = 10;
  cells.B34 = 20;
  cells.B32 = 8;
  cells.B33 = 12;
  const result = evaluateGasDev(cells);
  assert.equal(result.B35, 15);
  assert.equal(result.B36, 10);
});

test("air spring development interpolates ride height", () => {
  const cells = blankBatch4("dev_air_spring");
  cells.B8 = 4000;
  cells.D8 = 50;
  cells.B9 = 1;
  cells.B23 = 100;
  cells.B24 = 200;
  cells.C23 = 10;
  cells.C24 = 20;
  const result = evaluateAirSpringDev(cells);
  assert.equal(result.B25, 1000);
  assert.equal(result.B26, 200);
  assert.equal(result.B27, 100);
});

test("water and n-heptane calculators are separate", () => {
  const water = blankBatch4("volume_water");
  water.B4 = 100;
  water.B5 = 20;
  water.B6 = 760;
  water.B8 = 100;
  water.B9 = 100;
  const waterResult = evaluateWater(water);
  assert.equal(typeof waterResult.B23, "number");
  assert.equal(typeof waterResult.B16, "number");

  const heptane = blankBatch4("volume_heptane");
  heptane.B5 = 20;
  heptane.B8 = 100;
  heptane.B9 = 100;
  heptane.B4 = 50;
  heptane.B6 = 760;
  const heptaneResult = evaluateHeptane(heptane);
  assert.ok(Math.abs(Number(heptaneResult.B16) - 0.68376) < 1e-6);
  assert.notEqual(waterResult.B16, heptaneResult.B16);

  const line = blankBatch4("volume_water");
  line["1B2"] = 0;
  line["1B3"] = 100;
  line["1B6"] = 20;
  line["1B7"] = 760;
  line["1B9"] = 100;
  line["1B10"] = 100;
  const first = evaluateWater(line);
  line["1B4"] = first["1B12"] as number;
  assert.equal(evaluateWater(line)["1B14"], "PASS");
  line["1B4"] = 1;
  assert.equal(evaluateWater(line)["1B14"], "FAIL");
});
