import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REGISTRY } from "./registry.ts";
import { readWorkbookSample, sameValue } from "./workbookSample.ts";
import { showValue } from "./engine.ts";

/** The workbook file each form is drawn from. */
const WORKBOOKS: Record<string, string> = {
  shock: "FRM-VAL-002-Shock-RevB.xlsx",
  brake_wear: "FRM-VAL-009-Brake-Wear-Sensor-RevA.xlsx",
  electric_lift: "FRM-VAL-004-Electric-Lift-Support-RevC.xlsx",
  coil_spring: "FRM-VAL-006-Coil-Spring-RevA.xlsx",
  fuel_injector: "FRM-VAL-008-Fuel-Injector-RevB.xlsx",
  air_strut: "FRM-VAL-010-Air-Strut-RevA.xlsx",
  regular_gas_lift: "Gas-Lift-Support-Regular-FRM-VAL-012-RevA.xlsx",
};

/**
 * Fill each form with the values its workbook holds and compare every formula the app computes with the result Excel stored.
 * A formula the form deliberately changed (listed in its module's `formulas`) is skipped; every other one must match Excel.
 */
describe("every ported formula gives the result the workbook stored", () => {
  for (const [type, file] of Object.entries(WORKBOOKS)) {
    it(`${type}: ${file}`, async () => {
      const form = REGISTRY[type]!;
      const sample = await readWorkbookSample(file);
      const values = form.evaluate(sample.constants);
      const changed = new Set(Object.keys(form.def.formulas ?? {}));
      const wrong: string[] = [];
      let checked = 0;
      for (const [at, expected] of Object.entries(sample.cached)) {
        if (changed.has(at) || !form.formulas[at]) continue;
        checked += 1;
        if (!sameValue(values[at], expected)) wrong.push(`${at} =${form.formulas[at]}  app=${JSON.stringify(showValue(values[at]))} excel=${JSON.stringify(showValue(expected))}`);
      }
      assert.deepEqual(wrong, [], `${wrong.length} of ${checked} formulas differ from Excel`);
      assert.ok(checked > 0 || type === "regular_gas_lift");
    });
  }
});
