import assert from "node:assert/strict";
import test from "node:test";
import { blankBatch4, evaluateAirSpringDev, evaluateBatch4, evaluateCoilDev, evaluateWater, isBatch4, showBatch4 } from "./batch4Reports";
import { blankBatch5, evaluateBatch5, isBatch5, showBatch5 } from "./batch5Reports";
import { blankBatch6, evaluateBatch6, isBatch6, showBatch6 } from "./batch6Reports";
import { ISO_FORMS } from "./isoFormCatalog";

function rendered(formType: string): string[] {
  if (isBatch4(formType)) return Object.values(evaluateBatch4(formType, blankBatch4(formType))).map((value) => showBatch4(value));
  if (isBatch5(formType)) return Object.values(evaluateBatch5(formType, blankBatch5(formType))).map((value) => showBatch5(value));
  if (isBatch6(formType)) return Object.values(evaluateBatch6(formType, blankBatch6(formType))).map((value) => showBatch6(value));
  return [];
}

test("blank development and volume sheets do not render formula errors", () => {
  const forms = ISO_FORMS.filter((form) => form.formKey.startsWith("frm-dev-") || form.formKey.startsWith("frm-tst-"));
  assert.equal(forms.length, 15);
  for (const form of forms) {
    for (const text of rendered(form.formType)) {
      assert.equal(text.includes("#"), false, `${form.formKey} rendered ${text}`);
    }
  }
});

test("filled coil and air spring formulas accept typed numbers with units", () => {
  const coil = blankBatch4("dev_coil");
  coil.B8 = "4000 lbs";
  coil.D8 = "50%";
  coil.B9 = 1;
  coil.B26 = 30;
  coil.B19 = "12 mm";
  coil.B20 = "80 mm";
  const coilResult = evaluateCoilDev(coil);
  for (const value of Object.values(coilResult)) assert.equal(String(value).includes("#"), false);
  assert.equal(coilResult.B29, 4450);

  const air = blankBatch4("dev_air_spring");
  air.B8 = "4,000";
  air.D8 = "50%";
  air.B9 = 1;
  air.B23 = 100;
  air.B24 = 200;
  air.C23 = 10;
  air.C24 = 20;
  const airResult = evaluateAirSpringDev(air);
  for (const value of Object.values(airResult)) assert.equal(String(value).includes("#"), false);
  assert.equal(airResult.B25, 1000);
  assert.equal(airResult.B26, 200);
  assert.equal(airResult.B27, 100);
});

test("volume pass or fail uses the filled-to line once every input is present", () => {
  const line = blankBatch4("volume_water");
  line["1B2"] = 0;
  line["1B3"] = 100;
  line["1B6"] = 20;
  line["1B7"] = 760;
  line["1B8"] = 0;
  line["1B9"] = 100;
  line["1B10"] = 100;
  const open = evaluateWater(line);
  assert.equal(typeof open["1B12"], "number");
  assert.equal(open["1B14"], "");
  line["1B4"] = "100 mL";
  const judged = evaluateWater(line);
  assert.equal(judged["1B14"] === "PASS" || judged["1B14"] === "FAIL", true);
  assert.equal(String(judged["1B14"]).includes("#"), false);
  line["1B4"] = open["1B12"] as number;
  assert.equal(evaluateWater(line)["1B14"], "PASS");
});
