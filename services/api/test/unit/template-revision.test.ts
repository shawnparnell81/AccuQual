import { describe, expect, it } from "vitest";
import { FORM_TEMPLATE_CATALOG } from "../../src/modules/forms/formTemplateCatalog.js";
import { answersWithTemplateStamp, keptRevision, templateRevisionFor } from "../../src/modules/forms/templateRevision.js";
import { FIXED_TEMPLATE_REVISIONS, bumpRevision, hashedTemplateKeys, liveStructureHash, nextRevision } from "../../src/modules/forms/templateStructure.js";
import { ISO_FORM_TYPES } from "../../src/drizzle/schema/isoQualityForms.js";

describe("template revision", () => {
  it("keeps the stamp already on a filled form when answers are saved", () => {
    const previous = {
      part: "old",
      _formTemplate: { version: 3, revision: "C", structureHash: "abc" },
    };
    const saved = answersWithTemplateStamp("form:ncr", previous, { part: "new", _formTemplate: { version: 99, revision: "Z", structureHash: "nope" } }, false);
    expect(saved.part).toBe("new");
    expect(saved._formTemplate).toEqual({ version: 3, revision: "C", structureHash: "abc" });
  });

  it("stamps a new instance with the current master", () => {
    const saved = answersWithTemplateStamp("iso:ncr_report", undefined, { cells: { B6: "x" }, _formTemplate: { version: 9, revision: "Z", structureHash: "" } }, true);
    expect(saved._formTemplate).toEqual({ version: 3, revision: "C", structureHash: "" });
    expect(saved.cells).toEqual({ B6: "x" });
  });

  it("bumps a letter only when the structure hash changes", () => {
    const current = { version: 1, revision: "A", structureHash: "same" };
    expect(bumpRevision(current, "same")).toEqual(current);
    expect(bumpRevision(current, "different")).toEqual({ version: 2, revision: "B", structureHash: "different" });
    expect(nextRevision("Z")).toBe("AA");
    expect(nextRevision("1.0")).toBe("1.1");
  });

  it("keeps a stored header revision and fills an empty one from the master", () => {
    expect(keptRevision("B", "A")).toBe("B");
    expect(keptRevision("  ", "A")).toBe("A");
    expect(keptRevision(null, "1.0")).toBe("1.0");
    expect(templateRevisionFor("feasibility").revision).toBe("1.0");
    expect(templateRevisionFor("dcr").revision).toBe("A");
  });

  it("matches every API master hash, and records the published ISO and validation letters", () => {
    for (const key of hashedTemplateKeys()) {
      const recorded = FORM_TEMPLATE_CATALOG[key];
      expect(recorded, key).toBeTruthy();
      expect(recorded?.structureHash, `${key} changed. Bump that one entry with bumpRevision; do not regenerate the catalog.`).toBe(liveStructureHash(key));
    }
    for (const formType of ISO_FORM_TYPES) {
      expect(FIXED_TEMPLATE_REVISIONS[`iso:${formType}`]).toBeTruthy();
    }
    expect(FIXED_TEMPLATE_REVISIONS["validation:csa"]).toEqual({ version: 3, revision: "C" });
    expect(FIXED_TEMPLATE_REVISIONS["validation:fuel_pump"]).toEqual({ version: 3, revision: "C" });
    expect(FIXED_TEMPLATE_REVISIONS["iso:ncr_report"]).toEqual({ version: 3, revision: "C" });
  });
});
