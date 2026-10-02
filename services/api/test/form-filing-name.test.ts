import { describe, expect, it } from "vitest";
import { FORM_TEMPLATES, filedRecordName, fileNamePatternFor, storedFormId } from "../src/modules/document-folders/formFiling.js";

describe("cross-training filing name", () => {
  it("keeps the printed Doc ID and the document title", () => {
    const form = FORM_TEMPLATES.find((item) => item.formKey === "frm-trn-002");
    const training = FORM_TEMPLATES.find((item) => item.formKey === "frm-trn-001");
    const moduleRecord = FORM_TEMPLATES.find((item) => item.formKey === "training-record");
    expect(form?.formId).toBe("FRM-TRN-002");
    expect(form?.title).toBe("GRADING RUBRIC: CROSS-TRAINING EVALUATION");
    expect(training).toMatchObject({ formId: "FRM-TRN-001", title: "COMPETENCY AND TRAINING RECORD" });
    expect(moduleRecord?.title).toBe("Training & Competency Record");
    expect(fileNamePatternFor(form!)).toBe("{formId}_{recordNumber}_{date}");
    expect(filedRecordName("FRM-TRN-002", 4, "2026-09-28", fileNamePatternFor(form!))).toBe("FRM-TRN-002_4_2026-09-28");
    expect(filedRecordName("FRM-NCR-001", 4, "2026-09-28")).toBe("FRM-NCR-001_4_2026-09-28");
    expect(storedFormId("", "FRM-TRN-001")).toBe("FRM-TRN-001");
    expect(storedFormId("FRM-TRN-001", "FRM-TRN-001")).toBe("FRM-TRN-001");
    expect(storedFormId("FRM-VAL-001", "")).toBe("");
    expect(storedFormId("QA-14", "")).toBe("QA-14");
    expect(storedFormId("FRM-VAL-007", "FRM-VAL-007")).toBe("FRM-VAL-007");
    expect(storedFormId("FRM-VAL-007", "")).toBe("");
    expect(storedFormId("", "FRM-VAL-001", "frm-val-001")).toBe("FRM-VAL-001");
    expect(storedFormId("", "TMP-GEN-001", "frm-gen-002")).toBe("TMP-GEN-001");
    expect(storedFormId("FRM-VAL-009", "FRM-VAL-003", "frm-val-003")).toBe("FRM-VAL-003");
    expect(storedFormId("FRM-VAL-009", "FRM-VAL-009", "frm-val-009")).toBe("FRM-VAL-009");
    expect(storedFormId("FRM-VAL-011", "FRM-VAL-004", "frm-val-004")).toBe("FRM-VAL-004");
    expect(storedFormId("FRM-VAL-011", "FRM-VAL-011", "frm-val-011")).toBe("FRM-VAL-011");
    expect(storedFormId("FRM-VAL-007", "FRM-VAL-005", "frm-val-005")).toBe("FRM-VAL-005");
    expect(storedFormId("QA-14", "FRM-VAL-003", "frm-val-003")).toBe("QA-14");
  });

  it("names quality and engineering copies without a form number", () => {
    const names: Record<string, string> = {
      "frm-psw-001": "PSW_9_2026-09-28",
      "frm-prc-001": "TurtleDiagram_9_2026-09-28",
      "frm-qa-001": "QualityAlert_9_2026-09-28",
      "frm-fai-001": "FirstArticle_9_2026-09-28",
      "frm-cus-001": "CustomerScorecard_9_2026-09-28",
      "frm-fae-001": "FailureActionEffectiveness_9_2026-09-28",
      "frm-msa-001": "GageRR_9_2026-09-28",
      "frm-par-001": "Pareto_9_2026-09-28",
    };
    for (const [formKey, expected] of Object.entries(names)) {
      const form = FORM_TEMPLATES.find((item) => item.formKey === formKey);
      expect(form?.formId).toBe("");
      expect(filedRecordName("", 9, "2026-09-28", fileNamePatternFor(form!))).toBe(expected);
    }
  });
});
