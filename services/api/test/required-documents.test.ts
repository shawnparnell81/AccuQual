import { describe, expect, it } from "vitest";
import { normalizeRequiredDocumentIds } from "../src/modules/settings/requiredDocuments.js";

describe("normalizeRequiredDocumentIds", () => {
  it("defaults missing values to an empty list", () => {
    expect(normalizeRequiredDocumentIds(undefined)).toEqual([]);
    expect(normalizeRequiredDocumentIds(null)).toEqual([]);
    expect(normalizeRequiredDocumentIds("")).toEqual([]);
    expect(normalizeRequiredDocumentIds({})).toEqual([]);
  });

  it("migrates a single id string or number into a one-element array", () => {
    expect(normalizeRequiredDocumentIds("12")).toEqual(["12"]);
    expect(normalizeRequiredDocumentIds(12)).toEqual(["12"]);
    expect(normalizeRequiredDocumentIds("  8  ")).toEqual(["8"]);
  });

  it("keeps id order, drops free-text names, and rejects duplicates", () => {
    expect(normalizeRequiredDocumentIds(["4", "Customer Drawing", 4, "15", "0", "-3", "01", ""])).toEqual(["4", "15"]);
    expect(normalizeRequiredDocumentIds(["12", "12", 15])).toEqual(["12", "15"]);
  });
});
