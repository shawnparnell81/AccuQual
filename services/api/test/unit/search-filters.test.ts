import { describe, expect, it } from "vitest";
import { wantsRecordType } from "../../src/modules/search/searchFilters.js";

describe("command palette type filter", () => {
  it("matches a type token against the record family", () => {
    expect(wantsRecordType("NCR", "ncr")).toBe(true);
    expect(wantsRecordType("NCR", "issue")).toBe(true);
    expect(wantsRecordType("Document", "doc")).toBe(true);
    expect(wantsRecordType("CAPA", "ncr")).toBe(false);
  });

  it("leaves the search unscoped when no type token is set", () => {
    expect(wantsRecordType("Audit", "")).toBe(true);
  });
});
