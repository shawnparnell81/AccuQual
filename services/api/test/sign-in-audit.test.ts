import { describe, expect, it } from "vitest";
import { hashAuditValue, SIGN_IN_ENTITY_TYPE, signInAuditChanges } from "../src/modules/auth/signInAudit.js";
import { assertCanReadEntityHistory, canSeeCompanyAuditRow } from "../src/modules/audit-trail/auditTrailVisibility.js";
import type { Db } from "../src/lib/requestDb.js";

describe("sign-in audit rows", () => {
  it("stores a hash of the address and browser, never the raw values", () => {
    const changes = signInAuditChanges({
      action: "login",
      method: "password",
      client: { ip: "203.0.113.10", userAgent: "Mozilla/5.0" },
    });
    expect(changes.action).toBe("login");
    expect(changes.method).toBe("password");
    expect(changes.ipHash).toBe(hashAuditValue("203.0.113.10"));
    expect(changes.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(changes)).not.toContain("203.0.113.10");
    expect(JSON.stringify(changes)).not.toContain("Mozilla");
    expect(signInAuditChanges({ action: "logout", method: "session" })).toEqual({ action: "logout", method: "session" });
  });

  it("is visible to an owner or administrator and hidden from everyone else, including the person who signed in", () => {
    const row = { entityType: SIGN_IN_ENTITY_TYPE, entityId: 42 };
    expect(canSeeCompanyAuditRow("all", row, 7)).toBe(true);
    expect(canSeeCompanyAuditRow(new Set(["Document", "Supplier", "User"]), row, 42)).toBe(false);
    expect(canSeeCompanyAuditRow(new Set(["Document"]), { entityType: "User", entityId: 42 }, 42)).toBe(true);
    expect(canSeeCompanyAuditRow(new Set(["Document"]), { entityType: "User", entityId: 42 }, 7)).toBe(false);
  });

  it("refuses a non-admin reading the sign-in history endpoint", async () => {
    const db = {} as Db;
    await expect(assertCanReadEntityHistory(db, { id: 42, roleName: "operator", department: "quality" }, SIGN_IN_ENTITY_TYPE, 42)).rejects.toThrow(/Owner or Administrator/);
    await expect(assertCanReadEntityHistory(db, { id: 1, roleName: "admin", department: null }, SIGN_IN_ENTITY_TYPE, 42)).resolves.toBeUndefined();
  });
});
