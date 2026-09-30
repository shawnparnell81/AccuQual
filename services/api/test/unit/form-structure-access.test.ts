import { describe, expect, it } from "vitest";
import { canEditFormStructure } from "../../src/modules/roles/roleHierarchy.js";

describe("form structure editors", () => {
  it("allows the quality and engineering titles, and still allows owner and admin", () => {
    for (const roleName of [
      "owner",
      "admin",
      "quality_manager",
      "vice_president",
      "Quality Manager",
      "Engineering Manager",
      "Engineer",
      "Engineers",
      "Quality",
      "Product Engineer",
      "VP of Quality and Engineering",
    ]) {
      expect(canEditFormStructure({ roleName }), roleName).toBe(true);
    }
  });

  it("does not treat filling a form, or an unrelated title, as a structure edit", () => {
    for (const roleName of ["operator", "staff", "lead", "director", "president", "auditor", "supplier", "VP of Operations", "Quality Inspector"]) {
      expect(canEditFormStructure({ roleName }), roleName).toBe(false);
    }
    expect(canEditFormStructure(null)).toBe(false);
    expect(canEditFormStructure({ roleName: null })).toBe(false);
  });
});
