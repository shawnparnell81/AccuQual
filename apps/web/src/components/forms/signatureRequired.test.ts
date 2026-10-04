import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ncrLayout } from "./layouts/ncr.ts";
import { dimensionalReportLayout } from "./layouts/dimensionalReport.ts";
import { capaLayout } from "./layouts/capa.ts";
import { layoutSignatureBlocks, showsRequiredControl } from "./signatureRequired.ts";

describe("signature required control", () => {
  it("shows Required only on a layout with more than one signature block", () => {
    const ncr = layoutSignatureBlocks(ncrLayout);
    const capa = layoutSignatureBlocks(capaLayout);
    const dimensional = layoutSignatureBlocks(dimensionalReportLayout);
    assert.ok(ncr.length > 1);
    assert.equal(showsRequiredControl(ncr.length), true);
    assert.ok(capa.length > 1);
    assert.equal(dimensional.length, 1);
    assert.equal(showsRequiredControl(dimensional.length), false);
  });
});
