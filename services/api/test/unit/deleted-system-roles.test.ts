import { describe, expect, it } from "vitest";
import { deletedRoleNames, systemRolesToInsert, withDeletedRole, withoutDeletedRole } from "../../src/modules/roles/deletedSystemRoles.js";
import { ROLE_SEEDS } from "../../src/modules/roles/roleHierarchy.js";

describe("deleted system roles", () => {
  it("does not seed a built-in role an administrator has removed", () => {
    const deleted = withDeletedRole([], { name: "executive", deletedAt: "2026-10-10T00:00:00.000Z", deletedBy: 4, reason: "Not used" });
    const names = deletedRoleNames(deleted);
    expect([...names]).toEqual(["executive"]);
    const inserted = systemRolesToInsert(ROLE_SEEDS, ["owner", "admin"], [...names]).map((role) => role.name);
    expect(inserted).not.toContain("executive");
    expect(inserted).not.toContain("owner");
    expect(inserted).toContain("president");
    expect(withoutDeletedRole(deleted, "executive")).toEqual([]);
  });
});
