import { describe, expect, it } from "vitest";
import { decideRoleDeletion, displayNameForRole, hierarchyLevelForRoleName, moveRank, ROLE_SEEDS } from "../../src/modules/roles/roleHierarchy.js";

describe("role hierarchy", () => {
  it("orders the built-in roles from the top of the organization down", () => {
    const ordered = [...ROLE_SEEDS].sort((a, b) => a.hierarchyLevel - b.hierarchyLevel).map((role) => role.name);
    expect(ordered).toEqual(["owner", "admin", "executive", "president", "vice_president", "director", "quality_manager", "lead", "operator", "staff", "read_only", "auditor", "supplier", "customer"]);
  });

  it("maps titles onto the ladder", () => {
    expect(hierarchyLevelForRoleName("Owner")).toBe(10);
    expect(hierarchyLevelForRoleName("President")).toBe(20);
    expect(hierarchyLevelForRoleName("Vice President")).toBe(30);
    expect(hierarchyLevelForRoleName("VP")).toBe(30);
    expect(hierarchyLevelForRoleName("VP of Engineering / Quality")).toBe(30);
    expect(hierarchyLevelForRoleName("VP of Operations")).toBe(30);
    expect(hierarchyLevelForRoleName("Engineering VP")).toBe(80);
    expect(displayNameForRole({ name: "vice_president" })).toBe("Vice President");
    expect(displayNameForRole({ name: "quality_manager" })).toBe("Quality Manager");
    expect(displayNameForRole({ name: "staff" })).toBe("Staff");
    expect(displayNameForRole({ name: "read_only" })).toBe("Read-only");
    expect(displayNameForRole({ name: "VP of Operations" })).toBe("VP of Operations");
    expect(hierarchyLevelForRoleName("Quality Director")).toBe(40);
    expect(hierarchyLevelForRoleName("Plant Manager")).toBe(50);
    expect(hierarchyLevelForRoleName("Line Lead")).toBe(60);
    expect(hierarchyLevelForRoleName("Incoming Inspector")).toBe(70);
    expect(hierarchyLevelForRoleName("Operator")).toBe(80);
    expect(hierarchyLevelForRoleName("Guest")).toBe(90);
    expect(hierarchyLevelForRoleName("External Auditor")).toBe(92);
    expect(hierarchyLevelForRoleName("Supplier")).toBe(95);
    expect(hierarchyLevelForRoleName("Customer")).toBe(100);
    expect(hierarchyLevelForRoleName("owner")).toBeLessThan(hierarchyLevelForRoleName("president"));
    expect(hierarchyLevelForRoleName("president")).toBeLessThan(hierarchyLevelForRoleName("quality_manager"));
    expect(hierarchyLevelForRoleName("operator")).toBeLessThan(hierarchyLevelForRoleName("auditor"));
  });

  it("swaps ranks when a role moves up or down", () => {
    const roles = [
      { id: 1, hierarchyLevel: 10 },
      { id: 2, hierarchyLevel: 20 },
      { id: 3, hierarchyLevel: 50 },
    ];
    expect(moveRank(roles, 2, "up")).toEqual([
      { id: 2, hierarchyLevel: 10 },
      { id: 1, hierarchyLevel: 20 },
    ]);
    expect(moveRank(roles, 1, "up")).toEqual([]);
    expect(moveRank(roles, 3, "down")).toEqual([]);
  });

  it("allows a built-in role to be deleted, and blocks a role people still hold, the last role-management role, and the caller's own access", () => {
    const base = { replacementExists: true, replacementIsSameRole: false, replacementIsDeleted: false, roleManagesRoles: false, otherRoleManagesRoles: true, replacementManagesRoles: false, callerHoldsRole: false };
    expect(decideRoleDeletion({ ...base, displayName: "Executive", userCount: 0 })).toEqual({ ok: true, reassign: false });
    const held = decideRoleDeletion({ ...base, displayName: "Operator", userCount: 2 });
    expect(held.ok).toBe(false);
    if (!held.ok) expect(held.message).toMatch(/2 people are assigned to Operator/);
    expect(decideRoleDeletion({ ...base, displayName: "Operator", userCount: 2, replacementRoleId: 9 })).toEqual({ ok: true, reassign: true });
    const last = decideRoleDeletion({ ...base, displayName: "Administrator", userCount: 0, roleManagesRoles: true, otherRoleManagesRoles: false });
    expect(last.ok).toBe(false);
    if (!last.ok) expect(last.message).toMatch(/last role that can manage roles/);
    const own = decideRoleDeletion({ ...base, displayName: "Administrator", userCount: 1, replacementRoleId: 4, roleManagesRoles: true, otherRoleManagesRoles: true, callerHoldsRole: true, replacementManagesRoles: false });
    expect(own.ok).toBe(false);
    if (!own.ok) expect(own.message).toMatch(/your own access/);
  });
});
