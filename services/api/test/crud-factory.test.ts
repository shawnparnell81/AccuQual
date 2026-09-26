import { describe, expect, it } from "vitest";
import { stripClientOwnedFields } from "../src/utils/crudFactory.js";

describe("stripClientOwnedFields", () => {
  it("removes companyId so a client can never reassign a row to another company", () => {
    const cleaned = stripClientOwnedFields({ title: "Leak attempt", });
    expect(cleaned).toEqual({ title: "Leak attempt" });
  });

  it("removes id/createdAt/createdBy/siteId alongside companyId", () => {
    const cleaned = stripClientOwnedFields({
      id: 1,
      siteId: 9,
      createdAt: "2020-01-01",
      createdBy: 3,
      description: "kept",
    });
    expect(cleaned).toEqual({ description: "kept" });
  });

  it("leaves an already-clean body untouched", () => {
    const body = { title: "NCR", severity: "high" };
    expect(stripClientOwnedFields(body)).toEqual(body);
  });
});
