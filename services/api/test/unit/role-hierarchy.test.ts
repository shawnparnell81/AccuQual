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

  it("refuses to delete a built-in role, a role people still hold, or the last full-access role", () => {
    expect(decideRoleDeletion({ roleName: "owner", isProtected: true, userCount: 0, replacementExists: true, replacementIsSameRole: false, roleIsFullAccess: true, replacementIsFullAccess: false, otherActiveFullAccessUsers: 1 }).ok).toBe(false);
    const held = decideRoleDeletion({ roleName: "Floor Helper", isProtected: false, userCount: 2, replacementExists: true, replacementIsSameRole: false, roleIsFullAccess: false, replacementIsFullAccess: false, otherActiveFullAccessUsers: 1 });
    expect(held.ok).toBe(false);
    if (!held.ok) expect(held.message).toMatch(/2 people still have/);
    const moved = decideRoleDeletion({ roleName: "Floor Helper", isProtected: false, userCount: 2, replacementRoleId: 9, replacementExists: true, replacementIsSameRole: false, roleIsFullAccess: false, replacementIsFullAccess: false, otherActiveFullAccessUsers: 1 });
    expect(moved).toEqual({ ok: true, reassign: true });
    const last = decideRoleDeletion({ roleName: "Custom Admin", isProtected: false, userCount: 1, replacementRoleId: 4, replacementExists: true, replacementIsSameRole: false, roleIsFullAccess: true, replacementIsFullAccess: false, otherActiveFullAccessUsers: 0 });
    expect(last.ok).toBe(false);
  });
});
