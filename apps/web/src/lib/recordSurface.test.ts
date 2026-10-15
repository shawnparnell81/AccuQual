import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recordSurface } from "./recordSurface";

describe("record surfaces", () => {
  it("treats both master lists as lists", () => {
    assert.deepEqual(recordSurface("/documents/master-list"), { kind: "list", access: "documents" });
    assert.deepEqual(recordSurface("/documents/laboratory-scope"), { kind: "list", access: "documents" });
    assert.deepEqual(recordSurface("/documents/internal-audit-schedule"), { kind: "list", access: "documents" });
    assert.deepEqual(recordSurface("/documents/development-log"), { kind: "list", access: "documents" });
    assert.deepEqual(recordSurface("/documents/nonconformance-log"), { kind: "list", access: "documents" });
    assert.deepEqual(recordSurface("/documents/engineering-request-log"), { kind: "list", access: "documents" });
    assert.deepEqual(recordSurface("/calibration/master-list"), { kind: "list", access: "calibration" });
    assert.deepEqual(recordSurface("/kpis"), { kind: "list", access: "any" });
  });

  it("treats filled forms as forms and leaves indexes alone", () => {
    assert.equal(recordSurface("/iso-forms/record/12")?.kind, "form");
    assert.equal(recordSurface("/iso-forms/record/12")?.edit, false);
    assert.equal(recordSurface("/validation-reports/4")?.edit, false);
    assert.equal(recordSurface("/qms-forms/incoming_inspection_record/4")?.kind, "form");
    assert.equal(recordSurface("/ncr/9")?.kind, "form");
    assert.equal(recordSurface("/blank-forms"), null);
    assert.equal(recordSurface("/iso-forms/frm-ncr-001"), null);
    assert.equal(recordSurface("/documents/folders"), null);
    assert.equal(recordSurface("/risk/dashboard"), null);
    assert.equal(recordSurface("/form-builder/1"), null);
    assert.deepEqual(recordSurface("/form-builder/fills/1"), { kind: "form", access: "documents", edit: false });
    assert.deepEqual(recordSurface("/form-builder/template/4"), { kind: "form", access: "documents", edit: false });
    assert.equal(recordSurface("/ncr/9")?.edit, false);
    assert.equal(recordSurface("/ncr/9")?.kind, "form");
  });
});

it("record detail pages open locked and record Edit, Save and Cancel in one place", async () => {
  const { isLockedRecordPath, recordEditPath } = await import("./recordSurface");
  for (const path of ["/risk/4", "/capa/4", "/ncr/4", "/suppliers/4", "/ppap/4", "/complaints/4", "/fai-inspection/records/4", "/work-orders/4", "/documents/4"]) {
    assert.equal(isLockedRecordPath(path), true, path);
  }
  for (const path of ["/risk", "/qms-forms/frm-1/4", "/form-builder/fills/4", "/quality/4", "/fai-inspection/records/new"]) {
    assert.equal(isLockedRecordPath(path), false, path);
  }
  assert.equal(recordEditPath("/suppliers/7"), "/record-edits/suppliers/7");
  assert.equal(recordEditPath("/complaints/7"), "/complaints/7/begin-edit");
  assert.equal(recordEditPath("/fai-inspection/plans/7"), "/record-edits/fai-plans/7");
  assert.equal(recordEditPath("/risk/7"), null);
});
