import { describe, expect, it } from "vitest";
import { FORM_TEMPLATES, filedRecordName, fileNamePatternFor } from "../src/modules/document-folders/formFiling.js";

describe("cross-training filing name", () => {
  it("does not use a form number", () => {
    const form = FORM_TEMPLATES.find((item) => item.formKey === "frm-trn-002");
    expect(form?.formId).toBe("");
    expect(form?.title).toBe("Cross-Training Evaluation");
    expect(fileNamePatternFor(form!)).toBe("CrossTraining_{recordNumber}_{date}");
    expect(filedRecordName("", 4, "2026-09-28", fileNamePatternFor(form!))).toBe("CrossTraining_4_2026-09-28");
    expect(filedRecordName("FRM-NCR-001", 4, "2026-09-28")).toBe("FRM-NCR-001_4_2026-09-28");
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
