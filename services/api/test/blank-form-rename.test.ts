import { describe, expect, it } from "vitest";
import { blankFormFileName, checkBlankRename } from "../src/modules/document-folders/formTemplates.js";
import { AppError } from "../src/utils/appError.js";

const rows = [
  { formKey: "frm-dev-009", formId: "FRM-DEV-009", displayTitle: "AIR COMPRESSOR DEVELOPMENT DOCUMENT" },
  { formKey: "turtle", formId: "", displayTitle: "Turtle diagram" },
];

describe("Blank Forms rename", () => {
  it("builds the explorer name from number and title", () => {
    expect(blankFormFileName("FRM-DEV-009", "Air Compressor")).toBe("FRM-DEV-009 Air Compressor");
    expect(blankFormFileName("", "Turtle diagram")).toBe("Turtle diagram");
    expect(blankFormFileName(null, "Turtle diagram")).toBe("Turtle diagram");
  });

  it("trims and collapses spaces", () => {
    expect(checkBlankRename(rows, "frm-dev-009", "  Air   Compressor  ")).toBe("Air Compressor");
  });

  it("rejects empty, duplicate, and unknown", () => {
    expect(() => checkBlankRename(rows, "frm-dev-009", "   ")).toThrow(AppError);
    expect(() => checkBlankRename(rows, "frm-dev-009", "turtle DIAGRAM")).toThrow(/already has that name/);
    expect(() => checkBlankRename(rows, "missing", "X")).toThrow(AppError);
  });

  it("allows keeping its own name", () => {
    expect(checkBlankRename(rows, "turtle", "Turtle diagram")).toBe("Turtle diagram");
  });
});
