import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ENTITY_TYPE_TO_RESOURCE } from "../src/modules/audit-trail/auditTrailVisibility.js";
import { FILEABLE_FORM_KEYS, ISO_TYPE_TO_FORM_KEY } from "../src/modules/document-folders/editableForms.js";
import { MODULE_ENTITY_TYPES } from "../src/modules/workflow/workflow.controller.js";

const auditSql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/drizzle/post-migrate/audit-triggers.sql"), "utf8");

describe("ISO form history visibility", () => {
  it("lets a quality manager open ISO form history through the documents gate", () => {
    expect(ENTITY_TYPE_TO_RESOURCE["ISO form"]).toBe("documents");
    expect(MODULE_ENTITY_TYPES.iso_forms).toBe("ISO form");
    expect(ENTITY_TYPE_TO_RESOURCE.NCR).toBe("ncr");
    expect(ENTITY_TYPE_TO_RESOURCE.CAPA).toBe("capa");
    expect(ENTITY_TYPE_TO_RESOURCE["8D Report"]).toBe("eight_d");
    expect(ENTITY_TYPE_TO_RESOURCE["Validation Report"]).toBe("documents");
    expect(MODULE_ENTITY_TYPES.capa).toBe("CAPA");
    expect(MODULE_ENTITY_TYPES.eight_d).toBe("8D Report");
    expect(MODULE_ENTITY_TYPES.ncr).toBe("NCR");
  });

  it("audits iso form rows on save and leaves worksheet autosave off the trigger list", () => {
    expect(auditSql).toContain("('iso_quality_forms'");
    expect(auditSql).toContain("('validation_reports'");
    expect(auditSql).toContain("('qms_forms'");
    expect(auditSql).not.toMatch(/\('form_data'/);
  });

  it("files the NCR family and still files the forms that already filed", () => {
    expect(ISO_TYPE_TO_FORM_KEY.ncr_report).toBe("frm-ncr-001");
    expect(ISO_TYPE_TO_FORM_KEY.quarantine_notice).toBe("frm-ncr-002");
    expect(ISO_TYPE_TO_FORM_KEY.concession).toBe("frm-ncr-003");
    expect(ISO_TYPE_TO_FORM_KEY.internal_audit).toBe("frm-gen-001");
    expect(ISO_TYPE_TO_FORM_KEY.competency_training).toBe("frm-trn-001");
    expect(ISO_TYPE_TO_FORM_KEY.cross_training).toBe("frm-trn-002");
    expect(ISO_TYPE_TO_FORM_KEY.psw).toBe("frm-psw-001");
    expect(ISO_TYPE_TO_FORM_KEY.quality_alert).toBe("frm-qa-001");
    expect(ISO_TYPE_TO_FORM_KEY.first_article).toBe("frm-fai-001");
    expect(ISO_TYPE_TO_FORM_KEY.audit_summary).toBe("frm-gen-002");
    for (const key of ["frm-ncr-001", "frm-ncr-002", "frm-ncr-003", "frm-psw-001", "frm-qa-001", "frm-fai-001", "frm-val-001", "frm-gen-002"]) {
      expect(FILEABLE_FORM_KEYS.has(key)).toBe(true);
    }
    for (const key of ["ncr", "capa", "8d"]) {
      expect(FILEABLE_FORM_KEYS.has(key)).toBe(false);
    }
  });
});
