import assert from "node:assert/strict";
import test from "node:test";
import { FORMULAS, STATUS_COLORS, materializeRow } from "../components/forms/formulas.ts";
import { dimensionalReportLayout } from "../components/forms/layouts/dimensionalReport.ts";
import { finalInspectionReleaseChecklistLayout } from "../components/forms/layouts/finalInspectionReleaseChecklist.ts";
import type { TableBlock } from "../components/forms/layouts/types.ts";
import { faiFill, faiResult, inspectionItemResult, passFailFill, passFailPaint } from "./passFail.ts";

function table(layout: { sections: { blocks: { type: string; name?: string }[] }[] }, name: string): TableBlock {
  for (const section of layout.sections) {
    for (const block of section.blocks) {
      if (block.type === "table" && block.name === name) return block as TableBlock;
    }
  }
  throw new Error(`missing table ${name}`);
}

test("in tolerance is Pass and green, out of tolerance is Fail and red", () => {
  assert.equal(faiResult(10, 0.1, 10.05), "Pass");
  assert.equal(faiResult(10, 0.1, 10.2), "Fail");
  assert.equal(faiResult(10, 0.1, 10.1), "Pass");
  assert.equal(faiResult(10, 0.1, 9.9), "Pass");
  assert.equal(faiResult(10, 0.1, 9.89), "Fail");
  assert.equal(faiResult(10, "±0.20", 9.85), "Pass");
  assert.equal(faiResult(10, "+0.10/-0.05", 9.94), "Fail");
  assert.equal(faiResult(10, "+0.10/-0.05", 9.96), "Pass");
  assert.equal(faiResult(10, "9.5-10.5", 9.5), "Pass");
  assert.equal(faiResult("", "9.5-10.5", 10), "Pass");
  assert.equal(faiResult("10 mm", "±0.05 mm", "10.04 mm"), "Pass");
  assert.equal(faiResult("10 mm", "±0.05 mm", "10.06 mm"), "Fail");
  assert.equal(faiResult("", "0.1", 10), "");
  assert.equal(faiResult(10, "", 10), "");
  assert.equal(faiResult(10, 0.1, ""), "");

  assert.equal(passFailFill("Pass"), "fill-green");
  assert.equal(passFailFill("Fail"), "fill-red");
  assert.equal(faiFill("Pass"), "fill-green");
  assert.equal(faiFill("Fail"), "fill-red");
  assert.equal(faiFill(""), "");
  assert.equal(passFailPaint("Pass")?.bg, STATUS_COLORS.Pass?.bg);
  assert.equal(passFailPaint("Fail")?.bg, STATUS_COLORS.Fail?.bg);
  assert.equal(passFailPaint("pass")?.bg, "#4EA72E");
  assert.equal(passFailPaint("fail")?.bg, "#FF0000");
  assert.equal(passFailPaint(""), null);
});

test("dimensional sheet pass/fail is computed from nominal, tolerance, and actual", () => {
  const dimensions = table(dimensionalReportLayout, "dimensions");
  const passFail = dimensions.columns.find((column) => column.key === "passFail");
  assert.equal(passFail?.kind, "computed");
  assert.equal(passFail?.formula, "dimensionalPassFail");
  assert.equal(dimensions.columns.some((column) => column.key === "okNotOk"), false);
  assert.deepEqual(
    dimensions.columns.map((column) => column.key),
    ["dimensionSpecification", "nominal", "tolerance", "actual", "passFail", "testDate", "qtyTested"],
  );

  const inside = materializeRow({ nominal: "10", tolerance: "±0.10", actual: "10.05" }, dimensions.columns);
  assert.equal(inside.passFail, "Pass");
  const outside = materializeRow({ nominal: "10", tolerance: "0.10", actual: "10.25" }, dimensions.columns);
  assert.equal(outside.passFail, "Fail");
  const blank = materializeRow({ nominal: "10", tolerance: "", actual: "10" }, dimensions.columns);
  assert.equal(blank.passFail, "");

  const legacy = materializeRow(
    { specificationLimits: "10 ± 0.05", measurementResults: "10.02", okNotOk: { OK: true } },
    dimensions.columns,
  );
  assert.equal(legacy.nominal, "10");
  assert.equal(legacy.tolerance, "±0.05");
  assert.equal(legacy.actual, "10.02");
  assert.equal(legacy.passFail, "Pass");
  assert.equal(legacy.okNotOk, undefined);
  assert.equal(FORMULAS.dimensionalPassFail?.({ nominal: 25, tolerance: 1, actual: 27 }), "Fail");
});

test("key characteristic status and inspection min/max use the same check", () => {
  const characteristics = table(finalInspectionReleaseChecklistLayout, "keyCharacteristicResults");
  const status = characteristics.columns.find((column) => column.key === "status");
  assert.equal(status?.kind, "computed");
  assert.equal(status?.formula, "characteristicStatus");

  const row = materializeRow({ specTolerance: "10.00 ± 0.05", actualResult: "10.06" }, characteristics.columns);
  assert.equal(row.status, "Fail");
  const ok = materializeRow({ specTolerance: "10.00 ± 0.05", actualResult: "9.96" }, characteristics.columns);
  assert.equal(ok.status, "Pass");
  const prose = materializeRow({ specTolerance: "No burrs", actualResult: "None" }, characteristics.columns);
  assert.equal(prose.status, "");

  assert.equal(inspectionItemResult({ specMin: "9.9", specMax: "10.1", actualValue: "10" }), "pass");
  assert.equal(inspectionItemResult({ specMin: "9.9", specMax: "10.1", actualValue: "10.2" }), "fail");
  assert.equal(inspectionItemResult({ specMin: "10", specMax: null, actualValue: "10" }), "pass");
  assert.equal(inspectionItemResult({ specMin: "10", specMax: null, actualValue: "9.9" }), "fail");
  assert.equal(inspectionItemResult({ specMin: null, specMax: null, actualValue: "10" }), "");
  assert.equal(inspectionItemResult({ specification: "visual" } as { specMin?: unknown }), "");
});
