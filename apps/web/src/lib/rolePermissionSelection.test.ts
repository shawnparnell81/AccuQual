import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALL_PERMISSIONS_CONFIRM, allRolePermissionKeys, permissionCheckState, setPermissionKeys } from "./rolePermissionSelection.ts";

describe("role permission selection", () => {
  it("marks a group checked, empty, or partial", () => {
    assert.equal(permissionCheckState(["folders.rename"], ["folders.rename", "folders.delete"]), "partial");
    assert.equal(permissionCheckState(["folders.rename", "folders.delete"], ["folders.rename", "folders.delete"]), "all");
    assert.equal(permissionCheckState([], ["folders.rename"]), "none");
  });

  it("checks or clears one section and keeps permissions outside it", () => {
    const next = setPermissionKeys(["import_data"], ["folders.rename", "folders.delete"], true);
    assert.deepEqual(next, ["import_data", "folders.rename", "folders.delete"]);
    assert.deepEqual(setPermissionKeys(next, ["folders.rename", "folders.delete"], false), ["import_data"]);
  });

  it("checks every catalog permission without inventing a superuser flag", () => {
    const keys = allRolePermissionKeys();
    assert.ok(keys.includes("login_history"));
    assert.ok(keys.includes("executive.dashboard"));
    assert.ok(keys.includes("roles.manage"));
    const granted = setPermissionKeys(["custom.extra"], keys, true);
    assert.equal(permissionCheckState(granted, keys), "all");
    assert.ok(granted.includes("custom.extra"));
    assert.equal(ALL_PERMISSIONS_CONFIRM, "This gives the role every permission, including admin settings. Continue?");
  });
});
