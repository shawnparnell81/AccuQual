import { describe, expect, it } from "vitest";
import { canEditFormBuilder, canFillBuiltForm, canReadFormBuilder } from "../../src/modules/form-builder/access.js";
import { openFillCopy, saveFillAnswers, type BuiltTemplate } from "../../src/modules/form-builder/fillCopy.js";
import { bumpRevision, decideStructureSave } from "../../src/modules/form-builder/revision.js";
import { roleNameGetsFormBuilderSeed } from "../../src/modules/form-builder/seedNames.js";

const grid = { kind: "grid", sheets: [{ name: "Sheet1", cells: [] }] };
const edited = { kind: "grid", sheets: [{ name: "Sheet1", cells: [{ value: "x" }] }] };

describe("form builder revision", () => {
  it("bumps the letter only when a published structure changes", () => {
    expect(bumpRevision("A")).toBe("B");
    expect(bumpRevision("Z")).toBe("AA");

    const draft = decideStructureSave({
      mode: "autosave",
      status: "draft",
      revision: "A",
      publishedStructure: null,
      nextStructure: edited,
    });
    expect(draft.bumped).toBe(false);
    expect(draft.revision).toBe("A");
    expect(draft.recordHistory).toBe(false);

    const first = decideStructureSave({
      mode: "publish",
      status: "draft",
      revision: "A",
      publishedStructure: null,
      nextStructure: grid,
    });
    expect(first.bumped).toBe(false);
    expect(first.revision).toBe("A");
    expect(first.status).toBe("published");
    expect(first.recordHistory).toBe(true);

    const same = decideStructureSave({
      mode: "save",
      status: "published",
      revision: "A",
      publishedStructure: grid,
      nextStructure: grid,
    });
    expect(same.bumped).toBe(false);
    expect(same.recordHistory).toBe(false);

    const changed = decideStructureSave({
      mode: "publish",
      status: "published",
      revision: "A",
      publishedStructure: grid,
      nextStructure: edited,
    });
    expect(changed.bumped).toBe(true);
    expect(changed.revision).toBe("B");
    expect(changed.recordHistory).toBe(true);
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
