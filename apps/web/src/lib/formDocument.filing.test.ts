import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ISO_FORMS } from "./isoFormCatalog.ts";
import { FILEABLE_FORM_KEYS, FORM_KEY_BY_TYPE, filledCopyFolderSentence } from "./formDocument.ts";

const filingSentence = "A filled copy can be saved into any Documents folder.";

describe("filled ISO forms that can be filed", () => {
  it("maps FRM NCR, quarantine, concession, and the same omitted training and audit sheets", () => {
    assert.equal(FORM_KEY_BY_TYPE.ncr_report, "frm-ncr-001");
    assert.equal(FORM_KEY_BY_TYPE.quarantine_notice, "frm-ncr-002");
    assert.equal(FORM_KEY_BY_TYPE.concession, "frm-ncr-003");
    assert.equal(FORM_KEY_BY_TYPE.internal_audit, "frm-gen-001");
    assert.equal(FORM_KEY_BY_TYPE.competency_training, "frm-trn-001");
    assert.equal(FORM_KEY_BY_TYPE.cross_training, "frm-trn-002");
    for (const key of ["frm-ncr-001", "frm-ncr-002", "frm-ncr-003", "frm-gen-001", "frm-trn-001", "frm-trn-002"]) {
      assert.equal(FILEABLE_FORM_KEYS.has(key), true);
      assert.equal(filledCopyFolderSentence(key), filingSentence);
    }
  });

  it("keeps already-fileable forms on the filing list and leaves live NCR, CAPA, and 8D off it", () => {
    assert.equal(FORM_KEY_BY_TYPE.psw, "frm-psw-001");
    assert.equal(FORM_KEY_BY_TYPE.quality_alert, "frm-qa-001");
    assert.equal(FORM_KEY_BY_TYPE.first_article, "frm-fai-001");
    assert.equal(FORM_KEY_BY_TYPE.audit_summary, "frm-gen-002");
    for (const key of ["frm-psw-001", "frm-qa-001", "frm-fai-001", "frm-val-001", "frm-gen-002", "frm-car-001"]) {
      assert.equal(FILEABLE_FORM_KEYS.has(key), true);
      assert.equal(filledCopyFolderSentence(key), filingSentence);
    }
    for (const key of ["ncr", "capa", "8d"]) {
      assert.equal(FILEABLE_FORM_KEYS.has(key), false);
      assert.equal(filledCopyFolderSentence(key), "A filled copy is stored on this form. It is not saved into a Documents folder.");
    }
    for (const form of ISO_FORMS) {
      assert.equal(FORM_KEY_BY_TYPE[form.formType], form.formKey);
      assert.equal(FILEABLE_FORM_KEYS.has(form.formKey), true);
    }
  });
});
