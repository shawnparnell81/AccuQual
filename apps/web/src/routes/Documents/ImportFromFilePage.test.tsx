import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildConfirmValues, countEdited, rowStatus, type ReviewRow, type TargetField } from "./importFromFileReview";

function field(overrides: Partial<TargetField> = {}): TargetField {
  return { key: "status", label: "Status of Department", group: "Report", type: "text", ...overrides };
}

function row(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return { field: field(), original: "Yellow", value: "Yellow", source: "6.1 Executive Summary > 'Status of Department:'", ...overrides };
}

describe("ImportFromFilePage review logic", () => {
  it("is Matched when the value still equals the proposal", () => {
    assert.equal(rowStatus(row()), "Matched");
  });

  it("is Edited once the reviewer changes the value, and counts toward edited", () => {
    const edited = row({ value: "Red" });
    assert.equal(rowStatus(edited), "Edited");
    assert.equal(countEdited([row(), edited, row()]), 1);
  });

  it("is Empty when cleared, and Empty fields are left out of the save payload", () => {
    const cleared = row({ value: null });
    assert.equal(rowStatus(cleared), "Empty");
    const values = buildConfirmValues([row(), cleared]);
    assert.deepEqual(values, { status: "Yellow" });
  });

  it("treats an edited table value the same way as an edited scalar", () => {
    const tableField = field({ key: "topParts", type: "table", columns: [{ id: "part", label: "Part Number" }] });
    const original = [["A1", "Widget", "10"]];
    const sameTable = row({ field: tableField, original, value: original.map((line) => [...line]) });
    assert.equal(rowStatus(sameTable), "Matched");
    const changedTable = row({ field: tableField, original, value: [["A1", "Widget", "99"]] });
    assert.equal(rowStatus(changedTable), "Edited");
  });

  it("builds exactly one payload per save (no hidden extra fields, no empty ones)", () => {
    const rows = [row(), row({ field: field({ key: "achievement", label: "Primary Achievement" }), value: "Closed out 23 alerts." }), row({ field: field({ key: "recalls", label: "Recalls" }), value: null })];
    const values = buildConfirmValues(rows);
    assert.deepEqual(Object.keys(values).sort(), ["achievement", "status"]);
  });
});
