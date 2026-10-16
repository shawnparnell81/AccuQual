import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recordPdfSource } from "./recordPdf";

describe("recordPdfSource", () => {
  it("maps records the API renders to their real PDF routes", () => {
    assert.deepEqual(recordPdfSource("/capa/7"), { method: "post", url: "/forms/capa/7/export", fileName: "capa-7.pdf" });
    assert.equal(recordPdfSource("/8d/3")?.url, "/forms/eight_d/3/export");
    assert.equal(recordPdfSource("/iso-forms/record/5")?.url, "/iso-quality-forms/5/pdf");
    assert.equal(recordPdfSource("/qms-forms/frm-qms-003/9")?.url, "/qms-forms/9/pdf");
    assert.equal(recordPdfSource("/validation-reports/12?tab=x")?.url, "/validation-reports/12/pdf");
  });
  it("leaves new records and pages that already have their own Download PDF alone", () => {
    for (const path of ["/ncr/1", "/fai-inspection/records/1", "/fai/csa/1", "/capa", "/capa/new", "/qms-forms/frm-qms-003/new"]) assert.equal(recordPdfSource(path), null);
  });
});
