import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recordSurface } from "./recordSurface";

describe("record surfaces", () => {
  it("treats both master lists as lists", () => {
    assert.deepEqual(recordSurface("/documents/master-list"), { kind: "list", access: "documents" });
    assert.deepEqual(recordSurface("/calibration/master-list"), { kind: "list", access: "equipment-list" });
  });

  it("treats filled forms as forms and leaves indexes alone", () => {
    assert.equal(recordSurface("/iso-forms/record/12")?.kind, "form");
    assert.equal(recordSurface("/qms-forms/incoming_inspection_record/4")?.kind, "form");
    assert.equal(recordSurface("/ncr/9")?.kind, "form");
    assert.equal(recordSurface("/blank-forms"), null);
    assert.equal(recordSurface("/iso-forms/frm-ncr-001"), null);
    assert.equal(recordSurface("/documents/folders"), null);
    assert.equal(recordSurface("/risk/dashboard"), null);
  });
});
