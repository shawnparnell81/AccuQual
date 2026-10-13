import { describe, expect, it } from "vitest";
import { validationFormKeyFor, validationKind } from "../../src/modules/document-folders/editableForms.js";
import { formDataEdits } from "../../src/modules/forms/formEditAudit.js";
import { FIXED_TEMPLATE_REVISIONS } from "../../src/modules/forms/templateStructure.js";
import { createValidationReportSchema, updateValidationReportSchema } from "../../src/modules/validation-reports/validation-reports.validation.js";

const REGISTRY_TYPES = ["shock", "brake_wear", "electric_lift", "coil_spring", "fuel_injector", "air_strut", "regular_gas_lift"];

describe("registry validation forms on the server", () => {
  it("accepts every registry form type and maps each to its own form key", () => {
    const keys = new Set<string>();
    for (const type of REGISTRY_TYPES) {
      expect(createValidationReportSchema.safeParse({ data: { formType: type, cells: {} } }).success, type).toBe(true);
      expect(validationKind({ formType: type }), type).toBe(type);
      keys.add(validationFormKeyFor({ formType: type }));
    }
    expect(keys.size).toBe(REGISTRY_TYPES.length);
    expect(validationFormKeyFor({ formType: "regular_gas_lift" })).toBe("frm-val-012");
    expect(validationFormKeyFor({ formType: "gas_lift" })).toBe("frm-val-005");
  });

  it("publishes the workbook revisions: electric lift is C, regular gas lift is new at A, the rest are unchanged", () => {
    expect(FIXED_TEMPLATE_REVISIONS["validation:electric_lift"]?.revision).toBe("C");
    expect(FIXED_TEMPLATE_REVISIONS["validation:regular_gas_lift"]).toEqual({ version: 1, revision: "A" });
    expect(FIXED_TEMPLATE_REVISIONS["validation:shock"]?.revision).toBe("B");
    expect(FIXED_TEMPLATE_REVISIONS["validation:brake_wear"]?.revision).toBe("A");
    expect(FIXED_TEMPLATE_REVISIONS["validation:coil_spring"]?.revision).toBe("A");
    expect(FIXED_TEMPLATE_REVISIONS["validation:fuel_injector"]?.revision).toBe("B");
    expect(FIXED_TEMPLATE_REVISIONS["validation:air_strut"]?.revision).toBe("A");
    expect(FIXED_TEMPLATE_REVISIONS["validation:gas_lift"]?.revision).toBe("B");
  });
});

describe("Graphs tab data on a validation report", () => {
  const graph = { fields: { File: "run1.csv", Rate: "12.5" }, points: [[0, 0], [1.5, 20]] };

  it("is kept by the schema, not stripped", () => {
    const parsed = updateValidationReportSchema.parse({ data: { formType: "electric_lift", cells: {}, graph } });
    expect(parsed.data?.graph).toEqual(graph);
  });

  it("rejects a point that is not two numbers and a run over 50,000 points", () => {
    expect(updateValidationReportSchema.safeParse({ data: { graph: { points: [[1]] } } }).success).toBe(false);
    expect(updateValidationReportSchema.safeParse({ data: { graph: { points: [["a", 1]] } } }).success).toBe(false);
    const tooMany = Array.from({ length: 50001 }, (_, i) => [i, i]);
    expect(updateValidationReportSchema.safeParse({ data: { graph: { points: tooMany } } }).success).toBe(false);
    const max = Array.from({ length: 50000 }, (_, i) => [i, i]);
    expect(updateValidationReportSchema.safeParse({ data: { graph: { points: max } } }).success).toBe(true);
  });

  it("audits chart changes in plain words: field by name, points by count, never the raw numbers", () => {
    const before = { formType: "electric_lift", cells: {}, graph: { fields: { File: "a.csv" }, points: [[0, 0]] } };
    const after = { formType: "electric_lift", cells: {}, graph: { fields: { File: "b.csv" }, points: [[0, 0], [1, 2], [3, 4]] } };
    const edits = formDataEdits(before, after);
    expect(edits).toEqual([
      { label: "Chart File", from: "a.csv", to: "b.csv" },
      { label: "Chart data", from: "1 point", to: "3 points" },
    ]);
    expect(JSON.stringify(edits)).not.toContain("graph");
  });

  it("says when point values changed but the count did not, and writes nothing when the chart is the same", () => {
    const a = { graph: { fields: {}, points: [[0, 0], [1, 1]] } };
    const b = { graph: { fields: {}, points: [[0, 0], [1, 2]] } };
    expect(formDataEdits(a, b)).toEqual([{ label: "Chart data", from: "2 points", to: "2 points (values changed)" }]);
    expect(formDataEdits(a, a)).toEqual([]);
    expect(formDataEdits({ cells: {} }, { cells: {} })).toEqual([]);
  });

  it("a save without a graph key leaves the chart out of the audit", () => {
    expect(formDataEdits({ graph, cells: {} }, { cells: {} })).toEqual([]);
  });
});
