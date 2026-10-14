import { describe, expect, it } from "vitest";
import { canEditFormBuilder, canFillBuiltForm, canReadFormBuilder } from "../../src/modules/form-builder/access.js";
import { openFillCopy, saveFillAnswers, type BuiltTemplate } from "../../src/modules/form-builder/fillCopy.js";
import { decideStructureSave } from "../../src/modules/form-builder/revision.js";
import { roleNameGetsFormBuilderSeed } from "../../src/modules/form-builder/seedNames.js";

const grid = { kind: "grid", sheets: [{ name: "Sheet1", cells: [] }] };
const edited = { kind: "grid", sheets: [{ name: "Sheet1", cells: [{ value: "x" }] }] };

describe("form builder revision", () => {
  const published = { status: "published" as const, revision: "B", publishedStructure: grid, nextStructure: edited };

  it("keeps the REV on autosave and on a draft save", () => {
    const autosave = decideStructureSave({ mode: "autosave", status: "draft", revision: "A", publishedStructure: null, nextStructure: edited });
    expect(autosave.revision).toBe("A");
    expect(autosave.change).toBeNull();
    expect(autosave.recordHistory).toBe(false);

    const save = decideStructureSave({ mode: "save", status: "draft", revision: "A", publishedStructure: null, nextStructure: edited });
    expect(save.revision).toBe("A");
    expect(save.change).toBeNull();
    expect(save.status).toBe("draft");
    expect(save.recordHistory).toBe(true);
  });

  it("lets a draft take the REV a person typed, and keeps it on the first publish", () => {
    const typed = decideStructureSave({ mode: "save", status: "draft", revision: "A", publishedStructure: null, nextStructure: grid, newRevision: " 01 " });
    expect(typed.revision).toBe("01");
    const first = decideStructureSave({ mode: "publish", status: "draft", revision: "01", publishedStructure: null, nextStructure: grid });
    expect(first.revision).toBe("01");
    expect(first.change).toBeNull();
    expect(first.status).toBe("published");
    expect(first.recordHistory).toBe(true);
    expect(first.publishedStructure).toEqual(grid);
    expect(() => decideStructureSave({ mode: "save", status: "draft", revision: "A", publishedStructure: null, nextStructure: grid, newRevision: "   " })).toThrow();
    expect(() => decideStructureSave({ mode: "save", status: "draft", revision: "A", publishedStructure: null, nextStructure: grid, newRevision: "ABCDEFGHIJK" })).toThrow(/at most 10/);
  });

  it("rejects a structural change to a published form without a new REV", () => {
    for (const mode of ["save", "publish"] as const) {
      expect(() => decideStructureSave({ ...published, mode, changeDescription: "Added a row" })).toThrow("Enter the new revision. It must be different from REV B.");
      expect(() => decideStructureSave({ ...published, mode, newRevision: "   ", changeDescription: "Added a row" })).toThrow("Enter the new revision. It must be different from REV B.");
    }
  });

  it("rejects the same REV, in any letter case", () => {
    for (const typed of ["B", "b", " B "]) {
      expect(() => decideStructureSave({ ...published, mode: "save", newRevision: typed, changeDescription: "Added a row" })).toThrow("different from REV B");
    }
  });

  it("rejects a missing description and a REV that is too long", () => {
    expect(() => decideStructureSave({ ...published, mode: "save", newRevision: "C" })).toThrow("Describe what changed");
    expect(() => decideStructureSave({ ...published, mode: "save", newRevision: "C", changeDescription: "  " })).toThrow("Describe what changed");
    expect(() => decideStructureSave({ ...published, mode: "save", newRevision: "C".repeat(11), changeDescription: "Added a row" })).toThrow(/at most 10/);
  });

  it("applies a valid new REV exactly as typed", () => {
    for (const mode of ["save", "publish"] as const) {
      const decision = decideStructureSave({ ...published, mode, newRevision: " C2 ", changeDescription: " Added a row " });
      expect(decision.revision).toBe("C2");
      expect(decision.change).toEqual({ from: "B", to: "C2", description: "Added a row" });
      expect(decision.recordHistory).toBe(true);
      expect(decision.status).toBe("published");
      expect(decision.publishedStructure).toEqual(edited);
    }
  });

  it("never moves the REV by itself", () => {
    const same = decideStructureSave({ ...published, mode: "save", nextStructure: grid });
    expect(same.revision).toBe("B");
    expect(same.change).toBeNull();
    expect(same.recordHistory).toBe(false);
    const autosave = decideStructureSave({ ...published, mode: "autosave" });
    expect(autosave.revision).toBe("B");
    expect(autosave.publishedStructure).toEqual(grid);
    // A typed REV is ignored when the published structure did not change.
    expect(decideStructureSave({ ...published, mode: "publish", nextStructure: grid, newRevision: "Z" }).revision).toBe("B");
  });

  it("asks for a new REV when a published document header changes", () => {
    const doc = { kind: "document", html: "<p>Body</p>", showLogo: true, showPageNumbers: true, header: null, footer: null };
    const withHeader = {
      ...doc,
      header: { differentFirstPage: false, differentOddEven: false, defaultHtml: "<p>ACME Quality</p>", firstHtml: "", evenHtml: "" },
    };
    const base = { mode: "save" as const, status: "published" as const, revision: "A", publishedStructure: doc, nextStructure: withHeader };
    expect(() => decideStructureSave(base)).toThrow("different from REV A");
    const decision = decideStructureSave({ ...base, newRevision: "B", changeDescription: "Added the header" });
    expect(decision.change?.to).toBe("B");
    expect(decision.publishedStructure).toEqual(withHeader);
  });
});

describe("form builder permission", () => {
  it("allows a structure edit only when the permission is on", () => {
    expect(canEditFormBuilder({ roleName: "operator", roleHasPermission: false, moduleLevel: "none" })).toBe(false);
    expect(canEditFormBuilder({ roleName: "operator", roleHasPermission: false, moduleLevel: "read" })).toBe(false);
    expect(canReadFormBuilder({ roleName: "operator", roleHasPermission: false, moduleLevel: "read" })).toBe(true);
    expect(canEditFormBuilder({ roleName: "staff", roleHasPermission: true, moduleLevel: "none" })).toBe(true);
    expect(canEditFormBuilder({ roleName: "staff", roleHasPermission: false, moduleLevel: "edit" })).toBe(true);
    expect(canEditFormBuilder({ roleName: "owner", roleHasPermission: false, moduleLevel: "none" })).toBe(true);
    expect(canEditFormBuilder({ roleName: "Quality Manager", roleHasPermission: false, moduleLevel: "none" })).toBe(false);
  });

  it("lets a documents reader fill a copy without the builder permission", () => {
    const reader = { roleName: "operator", roleHasPermission: false, moduleLevel: "none" as const, documentsLevel: "read" as const };
    expect(canFillBuiltForm(reader)).toBe(true);
    expect(canEditFormBuilder(reader)).toBe(false);
    expect(canFillBuiltForm({ ...reader, documentsLevel: "none" })).toBe(false);
  });
});

describe("form builder fill copies", () => {
  it("does not change the template when a copy is opened or filled", () => {
    const template: BuiltTemplate = {
      id: 4,
      title: "Incoming check",
      formNumber: null,
      revision: "A",
      structure: grid,
    };
    const before = JSON.stringify(template);
    const fill = openFillCopy(template);
    fill.structure = edited;
    const saved = saveFillAnswers(fill, { A1: "12" });
    expect(JSON.stringify(template)).toBe(before);
    expect(template.revision).toBe("A");
    expect(template.formNumber).toBeNull();
    expect(saved.answers).toEqual({ A1: "12" });
    expect(saved.templateRevision).toBe("A");
    expect(saved.structure).not.toBe(template.structure);
  });

  it("copies the template header and footer onto a fill without changing the template revision", () => {
    const header = { differentFirstPage: true, differentOddEven: false, defaultHtml: "<p>Odd</p>", firstHtml: "<p>First</p>", evenHtml: "" };
    const footer = { differentFirstPage: false, differentOddEven: false, defaultHtml: "<p>Controlled</p>", firstHtml: "", evenHtml: "" };
    const template: BuiltTemplate = {
      id: 8,
      title: "Work instruction",
      formNumber: "WI-14",
      revision: "C",
      structure: { kind: "document", html: "<p>Body</p>", showLogo: true, showPageNumbers: true, header, footer },
    };
    const before = JSON.stringify(template);
    const fill = openFillCopy(template);
    expect(fill.templateRevision).toBe("C");
    expect(fill.templateFormNumber).toBe("WI-14");
    expect(fill.structure).toEqual(template.structure);
    expect(fill.structure).not.toBe(template.structure);
    const copy = fill.structure as { header: { defaultHtml: string } };
    copy.header.defaultHtml = "<p>Changed on the copy</p>";
    expect(JSON.stringify(template)).toBe(before);
    expect(template.revision).toBe("C");
  });
});

describe("form builder permission seed", () => {
  it("turns the permission on for the quality and engineering titles", () => {
    for (const roleName of ["quality_manager", "Quality Manager", "Engineering Manager", "Engineers", "Engineer", "Quality", "VP of Quality and Engineering", "Product Engineers", "Product Engineer"]) {
      expect(roleNameGetsFormBuilderSeed(roleName), roleName).toBe(true);
    }
    for (const roleName of ["operator", "staff", "president", "vice_president", "Quality Inspector", "VP of Operations", "auditor"]) {
      expect(roleNameGetsFormBuilderSeed(roleName), roleName).toBe(false);
    }
  });
});
