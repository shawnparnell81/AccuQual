import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLiveTabPath, selectRestoredTabs } from "./tabPaths.ts";

describe("saved tabs for removed pages", () => {
  it("drops purchasing screens and keeps pages that still exist", () => {
    const saved = [
      { id: "a", path: "/ncr" },
      { id: "b", path: "/erp" },
      { id: "c", path: "/erp/requisitions" },
      { id: "d", path: "/erp/requisitions/12" },
      { id: "e", path: "/erp/44" },
      { id: "f", path: "/feasibility" },
      { id: "g", path: "/feasibility/3" },
      { id: "h", path: "/erp/presets" },
      { id: "i", path: "/quality" },
      { id: "j", path: "/settings" },
    ];
    const restored = selectRestoredTabs(saved, "c");
    assert.deepEqual(
      restored.tabs.map((tab) => tab.path),
      ["/ncr", "/feasibility", "/feasibility/3", "/erp/presets", "/settings"],
    );
    assert.equal(restored.activeId, "a");
    assert.equal(isLiveTabPath("/erp/overview"), false);
    assert.equal(isLiveTabPath("/ncr/9"), true);
    assert.equal(isLiveTabPath("/inventory/lots/4/label"), true);
    assert.equal(isLiveTabPath("/admin/users"), true);
  });
});
