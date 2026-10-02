import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canMaintainMasterList } from "./masterListAccess.ts";

describe("master list maintainers", () => {
  it("lets Engineering, Quality Manager, VP of Engineering and Quality, and Admin edit and remove", () => {
    assert.equal(canMaintainMasterList({ roleName: "admin", department: null }), true);
    assert.equal(canMaintainMasterList({ roleName: "owner", department: null }), true);
    assert.equal(canMaintainMasterList({ roleName: "quality_manager", department: "production" }), true);
    assert.equal(canMaintainMasterList({ roleName: "Quality Manager", department: null }), true);
    assert.equal(canMaintainMasterList({ roleName: "operator", department: "engineering" }), true);
    assert.equal(canMaintainMasterList({ roleName: "Engineer", department: "production" }), true);
    assert.equal(canMaintainMasterList({ roleName: "VP of Engineering and Quality", department: null }), true);
  });

  it("leaves other roles off the lists", () => {
    assert.equal(canMaintainMasterList({ roleName: "operator", department: "production" }), false);
    assert.equal(canMaintainMasterList({ roleName: "staff", department: "quality" }), false);
    assert.equal(canMaintainMasterList({ roleName: "vice_president", department: null }), false);
    assert.equal(canMaintainMasterList({ roleName: "VP of Operations", department: null }), false);
    assert.equal(canMaintainMasterList(null), false);
  });
});
