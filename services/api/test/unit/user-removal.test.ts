import { describe, expect, it } from "vitest";
import { decideUserRemoval } from "../../src/modules/users/userRemoval.js";
import { formatUserLabel } from "../../src/modules/users/userDisplay.js";

const base = { actorId: 1, targetId: 2, targetRoleName: "operator", otherActiveFullAccess: 1, history: [] as { label: string; count: number }[] };

describe("user removal", () => {
  it("blocks deleting yourself and the last owner or administrator", () => {
    expect(decideUserRemoval({ ...base, actorId: 2, targetId: 2 }).outcome).toBe("blocked");
    const last = decideUserRemoval({ ...base, targetRoleName: "owner", otherActiveFullAccess: 0 });
    expect(last.outcome).toBe("blocked");
    if (last.outcome === "blocked") expect(last.message).toMatch(/last Owner or Administrator/);
  });

  it("erases an account with no history and turns off an account that has some", () => {
    expect(decideUserRemoval(base).outcome).toBe("deleted");
    const kept = decideUserRemoval({ ...base, history: [{ label: "NCRs", count: 3 }, { label: "audit log entries", count: 1 }] });
    expect(kept.outcome).toBe("deactivated");
    if (kept.outcome === "deactivated") expect(kept.message).toMatch(/3 NCRs/);
  });

  it("refuses to remove someone with open work until a replacement is chosen", () => {
    const openWork = [{ label: "open NCRs", count: 1 }, { label: "people who report to them", count: 2 }];
    const blocked = decideUserRemoval({ ...base, openWork });
    expect(blocked.outcome).toBe("blocked");
    if (blocked.outcome === "blocked") {
      expect(blocked.requiresReplacement).toBe(true);
      expect(blocked.message).toMatch(/open work/);
      expect(blocked.message).toMatch(/1 open NCRs/);
    }
    const ready = decideUserRemoval({ ...base, openWork, hasReplacement: true, history: [{ label: "NCRs", count: 1 }] });
    expect(ready.outcome).toBe("deactivated");
  });
});

describe("inactive names", () => {
  it("keeps the person's name and marks a turned-off account", () => {
    expect(formatUserLabel({ name: "Jane Doe", email: "jane@x.com", isActive: true }, 4)).toBe("Jane Doe");
    expect(formatUserLabel({ name: "Jane Doe", email: "jane@x.com", isActive: false }, 4)).toBe("Jane Doe (inactive)");
    expect(formatUserLabel({ name: "  ", email: "jane@x.com", isActive: false }, 4)).toBe("jane@x.com (inactive)");
    expect(formatUserLabel(undefined, 4)).toBe("Deleted User (ID #4)");
  });
});
