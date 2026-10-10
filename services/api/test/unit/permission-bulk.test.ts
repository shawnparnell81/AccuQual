import { describe, expect, it } from "vitest";
import { permissionDiff } from "../../src/modules/roles/permissionDiff.js";
import { departmentCellsThatChange } from "../../src/modules/permissions/departmentPermissionBulk.js";

describe("permission bulk changes", () => {
  it("lists every granted and revoked key in one diff", () => {
    expect(permissionDiff(["folders.rename"], ["folders.rename", "login_history", "sites.view_all"])).toEqual({
      granted: ["login_history", "sites.view_all"],
      revoked: [],
    });
    expect(permissionDiff(["import_data", "plants.delete"], ["plants.delete"])).toEqual({
      granted: [],
      revoked: ["import_data"],
    });
  });

  it("lists only department cells whose level changes", () => {
    const changes = departmentCellsThatChange(
      [{ departmentName: "quality", moduleName: "ncr", accessLevel: "read" }],
      [
        { departmentName: "quality", moduleName: "ncr", accessLevel: "edit" },
        { departmentName: "quality", moduleName: "capa", accessLevel: "edit" },
        { departmentName: "engineering", moduleName: "ncr", accessLevel: "none" },
      ],
    );
    expect(changes).toEqual([
      { departmentName: "quality", moduleName: "ncr", from: "read", to: "edit" },
      { departmentName: "quality", moduleName: "capa", from: "none", to: "edit" },
    ]);
  });
});
