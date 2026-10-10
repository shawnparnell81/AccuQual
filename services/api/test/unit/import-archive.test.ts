import { describe, expect, it } from "vitest";
import { IMPORT_CATALOG } from "../../src/modules/import/import.catalog.js";
import { applyHeaderMap, defaultImportName, headerMapFromIndexes, sumMappedField } from "../../src/modules/import/import.mapping.js";
import { resolveImportPulls } from "../../src/modules/import/import.archive.js";

describe("saved import column maps", () => {
  const fields = [{ key: "returns_count" }, { key: "warranty_amount" }];

  it("keeps O'Reilly's and NAPA as archive imports", () => {
    const oreilly = IMPORT_CATALOG.find((entry) => entry.key === "oreilly_reports");
    const napa = IMPORT_CATALOG.find((entry) => entry.key === "napa_reports");
    expect(oreilly).toMatchObject({ label: "O'Reilly's Reports", archiveOnly: true });
    expect(napa).toMatchObject({ label: "NAPA Reports", archiveOnly: true });
    expect(oreilly?.entity.fields.every((field) => !field.required)).toBe(true);
  });

  it("applies a saved header name after the columns move", () => {
    const suggested = { returns_count: 0, warranty_amount: 1 };
    const saved = { returns_count: "Qty Returned", warranty_amount: "Warranty $" };
    const next = applyHeaderMap(fields, ["Notes", "Warranty $", "Qty Returned"], saved, suggested);
    expect(next.applied).toBe(true);
    expect(next.mapping).toEqual({ returns_count: 2, warranty_amount: 1 });
    expect(headerMapFromIndexes(fields, ["Notes", "Warranty $", "Qty Returned"], next.mapping)).toEqual({
      returns_count: "Qty Returned",
      warranty_amount: "Warranty $",
    });
  });

  it("leaves the suggestion when this file does not have the saved header", () => {
    const next = applyHeaderMap(fields, ["Returns", "Warranty"], { returns_count: "Qty Returned" }, { returns_count: 0, warranty_amount: 1 });
    expect(next.mapping.returns_count).toBe(0);
    expect(next.applied).toBe(false);
  });

  it("names a file from the type and the date", () => {
    expect(defaultImportName("NAPA Reports", new Date(2026, 9, 2))).toBe("NAPA Reports 2026-10-02");
  });

  it("sums a mapped column and labels the source import", () => {
    expect(sumMappedField([{ mapped: { warranty_amount: "$10.50" } }, { mapped: { warranty_amount: "" } }, { mapped: { warranty_amount: "2" } }], "warranty_amount")).toBe(12.5);
    const lines = resolveImportPulls(
      [{ importId: 4, section: "warranty", field: "warranty_amount" }],
      [{ importId: 4, displayName: "O'Reilly's Reports 2026-10-01", typeLabel: "O'Reilly's Reports", rows: [{ mapped: { warranty_amount: "10" } }, { mapped: { warranty_amount: "5" } }] }],
    );
    expect(lines).toEqual([
      {
        importId: 4,
        section: "warranty",
        field: "warranty_amount",
        fieldLabel: "Warranty amount",
        total: 15,
        source: "O'Reilly's Reports 2026-10-01 · O'Reilly's Reports",
        missing: false,
      },
    ]);
  });
});
