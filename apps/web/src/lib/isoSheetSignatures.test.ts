import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ncrLayout } from "./isoFormLayouts";
import { pswLayout, qualityAlertLayout } from "./qualitySheetLayouts";
import { ISO_SHEET_SIGNATURES, sheetSignatures } from "./isoSheetSignatures";

function cell(layout: { rows: { addr: string; kind: string; signatureKey?: string }[][] }, addr: string) {
  return layout.rows.flat().find((item) => item?.addr === addr);
}

describe("ISO sheet signature rows", () => {
  it("are PIN signature cells, not typed text", () => {
    for (const [layout, addr, key] of [[ncrLayout(), "B29", "engineeringManagerSignature"], [pswLayout(), "B48", "organizationSignature"], [qualityAlertLayout(), "B13", "approverSignature"], [qualityAlertLayout(), "B15", "extensionSignature"]] as const) {
      const found = cell(layout, addr);
      assert.equal(found?.kind, "signature");
      assert.equal(found?.signatureKey, key);
    }
  });
  it("leaves header Approved By (master form approver) alone", () => {
    assert.equal(ISO_SHEET_SIGNATURES.visitor_log, undefined);
    assert.equal(ISO_SHEET_SIGNATURES.dev_csa, undefined);
  });
  it("reads only recorded stamps for the form", () => {
    assert.deepEqual(sheetSignatures("psw", { organizationSignature: "A — date", other: "x" }), { organizationSignature: "A — date" });
    assert.deepEqual(sheetSignatures("psw", {}), {});
  });
});
