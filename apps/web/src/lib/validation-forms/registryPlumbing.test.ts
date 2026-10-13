import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { headerStatusFor } from "../headerStatus";
import { failedValidationRows } from "../validationFailures";
import { VALIDATION_FORMS, formTypeOf, type ValidationFormType } from "../validationReport";
import { SHOCK_FORM } from "./forms/shock";
import { REGISTRY } from "./registry";

describe("registry forms and the validation form list agree", () => {
  for (const [type, module] of Object.entries(REGISTRY)) {
    it(`${type}: number, title, Rev and pass color match VALIDATION_FORMS`, () => {
      const meta = VALIDATION_FORMS[type as ValidationFormType];
      assert.ok(meta, `${type} is missing from VALIDATION_FORMS`);
      assert.equal(module.def.type, type);
      assert.equal(meta.formKey, module.def.docId.toLowerCase());
      assert.equal(meta.title, module.def.title);
      assert.equal(meta.revision, module.def.revision);
      assert.equal(meta.pass.toLowerCase(), module.def.passFill.toLowerCase());
      assert.equal(formTypeOf({ formType: type }), type);
    });
  }

  it("the workbook revisions: electric lift C, regular gas lift A (FRM-VAL-012)", () => {
    assert.equal(VALIDATION_FORMS.electric_lift.revision, "C");
    assert.equal(VALIDATION_FORMS.regular_gas_lift.revision, "A");
    assert.equal(VALIDATION_FORMS.regular_gas_lift.formKey, "frm-val-012");
    assert.equal(VALIDATION_FORMS.gas_lift.formKey, "frm-val-005", "the existing gas lift form is untouched");
  });
});

function passingShock() {
  const cells: Record<string, string | number | boolean> = { ...SHOCK_FORM.blank(), C11: 10, E11: 10, F11: 10, C15: 400, E15: 401, F15: 399, C17: 150, E17: 151, F17: 149, E16: 250, F16: 250, C18: 25, E18: 30, F18: 28, G10: "Passed", H10: "Passed" };
  for (const row of [22, 23, 24, 25, 26, 27, 28, 29, 30, 31]) Object.assign(cells, { [`C${row}`]: 100, [`D${row}`]: 10, [`E${row}`]: 105, [`F${row}`]: 95 });
  for (const row of [35, 36, 37, 38]) Object.assign(cells, { [`C${row}`]: 20, [`E${row}`]: 20.2, [`F${row}`]: 19.8 });
  return cells;
}

describe("header status of a registry form", () => {
  it("is Not started for a blank sheet, and for a sheet holding only its prefilled defaults", () => {
    assert.equal(headerStatusFor("shock", {}), "Not started");
    assert.equal(headerStatusFor("shock", SHOCK_FORM.blank()), "Not started");
  });

  it("is In progress once something is typed and the sheet is not finished", () => {
    assert.equal(headerStatusFor("shock", { C15: 400 }), "In progress");
  });

  it("is Pass on a finished passing sheet and Fail when one measurement is out", () => {
    assert.equal(headerStatusFor("shock", passingShock()), "Pass");
    const failing = { ...passingShock(), F26: 130 };
    assert.equal(headerStatusFor("shock", failing), "Fail");
  });
});

describe("failed rows for an NCR from a registry form", () => {
  it("lists nothing for a blank or passing sheet", () => {
    assert.deepEqual(failedValidationRows("shock", {}), []);
    assert.deepEqual(failedValidationRows("shock", passingShock()), []);
  });

  it("lists the failed rows by the workbook's own row label, with what was measured", () => {
    const rows = failedValidationRows("shock", { ...passingShock(), F26: 130 });
    assert.ok(rows.length >= 1);
    const failed = rows.find((row) => row.addr === "H26");
    assert.ok(failed, "H26 is a failed row");
    assert.match(failed.measurement, /\S/);
    assert.notEqual(failed.measurement, "Row 26", "the row label comes from the workbook");
    assert.equal(failed.actual, "130", "the sample-2 value that failed");
  });

  it("does not list the overall result as a failed measurement", () => {
    const rows = failedValidationRows("shock", { ...passingShock(), F26: 130 });
    assert.equal(rows.some((row) => row.addr === "A3"), false);
  });
});
