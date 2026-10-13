import assert from "node:assert/strict";
import test from "node:test";
import { collectInspectionFailures } from "./inspectionFailures.ts";
import { FUEL_INJECTOR_FORM } from "./validation-forms/forms/fuel_injector.ts";
import { readWorkbookSample } from "./validation-forms/workbookSample.ts";
import { failedValidationRows } from "./validationFailures.ts";

test("a blank fuel injector does not offer Create NCR rows", () => {
  assert.equal(failedValidationRows("fuel_injector", FUEL_INJECTOR_FORM.blank()).length, 0);
});

test("a failed fuel injector check is copied as measurement, spec, and actual", async () => {
  // The fuel injector is drawn from its workbook now: a Y/N check (G23) that is N fails its result (H23).
  const rows = failedValidationRows("fuel_injector", { ...(await readWorkbookSample("FRM-VAL-008-Fuel-Injector-RevB.xlsx")).constants, G23: "N" });
  const row = rows.find((item) => item.addr === "H23");
  assert.ok(row);
  assert.equal(row?.actual, "N");
});

test("a picture-form inspection copies the failed row", () => {
  const rows = collectInspectionFailures({
    checks: [{ requirement: "Threads", specification: "M8", actual: "M6", result: "Fail" }, { requirement: "Finish", specification: "Clean", actual: "Clean", result: "Pass" }],
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { measurement: "Threads", spec: "M8", actual: "M6" });
});
