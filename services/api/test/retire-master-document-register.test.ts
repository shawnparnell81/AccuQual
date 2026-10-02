import { describe, expect, it } from "vitest";
import {
  FORM_TEMPLATES,
  MASTER_DOCUMENT_LIST_PATH,
  RETIRED_FORM_KEYS,
  RETIRED_REGISTER_BLANK_PATH,
  retargetRetiredRegisterLink,
} from "../src/modules/document-folders/formFiling.js";
import { getQmsFormDefinition, isRetiredQmsFormType, liveQmsFormDefinitions } from "../src/modules/qms-forms/qmsFormDefinitions.js";
import { createQmsFormSchema } from "../src/modules/qms-forms/qmsForms.validation.js";

describe("retired Master Document Register", () => {
  it("keeps Master Document List and takes the Register blank out of the library", () => {
    const list = FORM_TEMPLATES.find((form) => form.formKey === "lst-gen-001");
    expect(list).toMatchObject({
      title: "Master Document List",
      topic: "Document Control",
      subjectRoute: MASTER_DOCUMENT_LIST_PATH,
      start: null,
    });
    expect(FORM_TEMPLATES.some((form) => form.formKey === "master_document_register" || form.title === "Master Document Register")).toBe(false);
    expect(RETIRED_FORM_KEYS).toEqual(["master_document_register"]);
    const revision = FORM_TEMPLATES.find((form) => form.formKey === "document_revision_record");
    expect(revision).toMatchObject({
      title: "Document Revision Record",
      topic: "Document Control",
      subjectRoute: "/qms-forms/document_revision_record",
    });
    expect(revision?.start?.body).toEqual({ formType: "document_revision_record" });
  });

  it("sends the blank Register shortcut to the live list and leaves a filled copy", () => {
    expect(retargetRetiredRegisterLink(RETIRED_REGISTER_BLANK_PATH)).toBe(MASTER_DOCUMENT_LIST_PATH);
    expect(retargetRetiredRegisterLink("/qms-forms/master_document_register/12")).toBe("/qms-forms/master_document_register/12");
    expect(retargetRetiredRegisterLink("/documents/master-list")).toBe("/documents/master-list");
    expect(retargetRetiredRegisterLink(null)).toBeNull();
  });

  it("hides the Register from new forms and still knows how to open a filled copy", () => {
    expect(liveQmsFormDefinitions().some((definition) => definition.formType === "master_document_register")).toBe(false);
    expect(liveQmsFormDefinitions().some((definition) => definition.formType === "document_revision_record")).toBe(true);
    expect(isRetiredQmsFormType("document_revision_record")).toBe(false);
    expect(isRetiredQmsFormType("master_document_register")).toBe(true);
    expect(getQmsFormDefinition("master_document_register")?.title).toBe("Master Document Register");
    expect(createQmsFormSchema.safeParse({ formType: "master_document_register" }).success).toBe(false);
    expect(createQmsFormSchema.safeParse({ formType: "document_revision_record" }).success).toBe(true);
    expect(createQmsFormSchema.safeParse({ formType: "record_retention_log" }).success).toBe(true);
  });
});
