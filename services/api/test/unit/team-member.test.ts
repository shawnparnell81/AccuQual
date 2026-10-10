import { describe, expect, it } from "vitest";
import { evaluateMfa } from "../../src/modules/auth/mfa.service.js";
import { changedEdits, describeModuleLevel, describeStoredPermissions } from "../../src/modules/users/userProfile.js";

describe("team member profile", () => {
  it("records old and new values only for fields that changed", () => {
    const edits = changedEdits(
      { jobTitle: null, phone: "100", requireMfa: false },
      { jobTitle: "Inspector", phone: "100", requireMfa: true },
      { jobTitle: "Job title", phone: "Phone", requireMfa: "Require two-step sign-in" },
    );
    expect(edits).toEqual([
      { label: "Job title", from: "(blank)", to: "Inspector" },
      { label: "Require two-step sign-in", from: "No", to: "Yes" },
    ]);
  });

  it("describes permissions stored on the role and does not invent access from the role name", () => {
    expect(describeStoredPermissions([])).toEqual([]);
    expect(describeStoredPermissions(["login_history"])).toEqual(["Can view login history"]);
    expect(describeStoredPermissions(["custom.flag"])).toEqual(['Has the stored permission "custom.flag"']);
    expect(describeModuleLevel("NCR", "edit")).toBe("Can change NCR.");
    expect(describeModuleLevel("NCR", "none")).toBeNull();
    expect(describeStoredPermissions([]).join(" ")).not.toMatch(/everything|full access/i);
  });

  it("treats a personal two-step requirement as required even when company policy is optional", () => {
    const optional = evaluateMfa({ mfaEnabled: false, mfaRequiredSince: null }, "staff", "optional");
    expect(optional.required).toBe(false);
    const personal = evaluateMfa({ mfaEnabled: false, mfaRequiredSince: null }, "staff", "optional", new Date(), true);
    expect(personal.required).toBe(true);
    expect(personal.state === "grace" || personal.state === "blocked").toBe(true);
  });
});

