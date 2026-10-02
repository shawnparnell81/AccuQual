import { describe, expect, it } from "vitest";
import { isMasterListMaintainerWrite, isMasterToolListEditPath } from "../../src/middleware/departmentAccess.js";
import { canMaintainMasterList } from "../../src/modules/roles/roleHierarchy.js";

describe("master list maintainers", () => {
  it("allows Engineering, Quality Manager, VP of Engineering and Quality, and Administrator", () => {
    for (const roleName of [
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
    ]) {
      expect(canMaintainMasterList({ roleName, department: null }), roleName).toBe(true);
    }
    expect(canMaintainMasterList({ roleName: "operator", department: "engineering" })).toBe(true);
  });

  it("does not treat an unrelated title or department as a master-list edit", () => {
    for (const roleName of ["operator", "staff", "lead", "director", "president", "auditor", "supplier", "VP of Operations", "Quality Inspector", "Quality"]) {
      expect(canMaintainMasterList({ roleName, department: "production" }), roleName).toBe(false);
    }
    expect(canMaintainMasterList({ roleName: "operator", department: "quality" })).toBe(false);
    expect(canMaintainMasterList(null)).toBe(false);
    expect(canMaintainMasterList({ roleName: null, department: null })).toBe(false);
  });

  it("opens the master-list writes and leaves other writes closed", () => {
    const user = { roleName: "VP of Engineering and Quality", department: "production" };
    expect(isMasterListMaintainerWrite({ baseUrl: "/documents", method: "PATCH", path: "/master-list/rows", user })).toBe(true);
    expect(isMasterListMaintainerWrite({ baseUrl: "/documents", method: "DELETE", path: "/master-list/rows", user })).toBe(true);
    expect(isMasterListMaintainerWrite({ baseUrl: "/equipment", method: "PATCH", path: "/12", user })).toBe(true);
    expect(isMasterListMaintainerWrite({ baseUrl: "/equipment", method: "DELETE", path: "/12", user })).toBe(true);
    expect(isMasterListMaintainerWrite({ baseUrl: "/equipment", method: "POST", path: "/12/status", user })).toBe(true);
    expect(isMasterListMaintainerWrite({ baseUrl: "/equipment", method: "POST", path: "/12/calibration", user })).toBe(true);
    expect(isMasterListMaintainerWrite({ baseUrl: "/documents", method: "DELETE", path: "/4", user })).toBe(false);
    expect(isMasterListMaintainerWrite({ baseUrl: "/equipment", method: "POST", path: "/", user })).toBe(false);
    expect(isMasterListMaintainerWrite({ baseUrl: "/documents", method: "PATCH", path: "/4", user })).toBe(false);
    expect(isMasterToolListEditPath("DELETE", "/4")).toBe(true);
    expect(isMasterToolListEditPath("POST", "/")).toBe(true);
    expect(isMasterToolListEditPath("POST", "/4/draft")).toBe(true);
    expect(isMasterToolListEditPath("PATCH", "/4/draft/9")).toBe(true);
    expect(isMasterToolListEditPath("POST", "/4/version/9/publish")).toBe(false);
    expect(isMasterToolListEditPath("POST", "/4/version/9/review/approve")).toBe(false);
    expect(isMasterListMaintainerWrite({ baseUrl: "/documents", method: "DELETE", path: "/master-list/rows", user: { roleName: "operator", department: "quality" } })).toBe(false);
  });
});
