import assert from "node:assert/strict";
import test from "node:test";
import { collectInspectionFailures } from "./inspectionFailures.ts";
import { blankInjectorCells } from "./partInspection.ts";
import { failedValidationRows } from "./validationFailures.ts";

test("a blank fuel injector does not offer Create NCR rows", () => {
  assert.equal(failedValidationRows("fuel_injector", blankInjectorCells()).length, 0);
});

test("a failed fuel injector check is copied as measurement, spec, and actual", () => {
  const rows = failedValidationRows("fuel_injector", { ...blankInjectorCells(), G21: "N" });
  const row = rows.find((item) => item.addr === "H21");
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
