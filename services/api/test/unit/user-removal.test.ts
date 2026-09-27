import { describe, expect, it } from "vitest";
import { decideUserRemoval } from "../../src/modules/users/userRemoval.js";

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
});
