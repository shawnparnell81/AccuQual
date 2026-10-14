import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { offersScreenPrint } from "./printDocument";
import { recordSurface } from "./recordSurface";

/** One path per fillable form page, saved and unsaved (opened from Blank Forms). */
const FORM_PATHS = [
  "/validation-reports/12", "/validation-reports/new",
  "/iso-forms/record/7", "/iso-forms/record/new",
  "/qms-forms/first_article_inspection/3", "/qms-forms/first_article_inspection/new",
  "/ncr/1", "/capa/1", "/8d/1", "/audits/1", "/change/1", "/risk/1", "/feasibility/1", "/document-change-requests/1",
  "/scar-forms/1", "/quality-inspection-reports/1", "/ppap/1", "/calibration/1", "/quarantine/1", "/crar/1", "/warranty/1",
  "/labor-claims/1", "/work-orders/1", "/rma/1", "/training/1", "/training/employee/1", "/pareto",
  "/fai-inspection/records/4", "/fai-inspection/records/new", "/fai-inspection/plans/2", "/fai-inspection/plans/new",
  "/complaints/5", "/quality/5", "/reporting/imported-data/5", "/reports",
  "/form-builder/fills/9", "/form-builder/template/9",
  "/documents/master-list", "/calibration/master-list", "/documents/nonconformance-log",
];

describe("every form has Print", () => {
  for (const path of FORM_PATHS) it(path, () => assert.ok(offersScreenPrint(path), path));

  it("adding Print did not add a page Edit button to pages that had none", () => {
    for (const path of ["/validation-reports/new", "/iso-forms/record/new", "/qms-forms/x/new", "/fai-inspection/records/4", "/complaints/5", "/quality/5", "/reporting/imported-data/5", "/reports"]) {
      assert.equal(recordSurface(path)?.edit, false, path);
    }
  });

  it("the Print button lives in the shared workspace chrome", () => {
    const kept = readFileSync(new URL("../components/layout/KeptSection.tsx", import.meta.url), "utf8");
    assert.match(kept, /<PrintChrome \/>/);
  });
});
