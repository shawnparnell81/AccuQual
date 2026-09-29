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
});
