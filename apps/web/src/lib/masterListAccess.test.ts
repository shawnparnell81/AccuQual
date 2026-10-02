import assert from "node:assert/strict";
import test from "node:test";
import { canMaintainMasterList } from "./masterListAccess";

const ALLOWED = [
  "admin",
  "owner",
  "Administrator",
  "Admin",
  "quality_manager",
  "Quality Manager",
  "vice_president",
  "VP of Engineering and Quality",
  "VP of Quality and Engineering",
  "Vice President of Engineering",
  "Engineering",
  "Engineer",
  "Engineering Manager",
];

const DENIED = ["operator", "staff", "lead", "director", "president", "auditor", "supplier", "VP of Operations", "Quality Inspector", "Quality"];

test("master list edit and remove stay with engineering, quality manager, VP engineering/quality, and administrator", () => {
  for (const roleName of ALLOWED) assert.equal(canMaintainMasterList({ roleName, department: null }), true, roleName);
  for (const roleName of DENIED) assert.equal(canMaintainMasterList({ roleName, department: "production" }), false, roleName);
  assert.equal(canMaintainMasterList({ roleName: "operator", department: "engineering" }), true);
  assert.equal(canMaintainMasterList({ roleName: "operator", department: "quality" }), false);
  assert.equal(canMaintainMasterList(null), false);
  assert.equal(canMaintainMasterList({ roleName: null, department: null }), false);
});
