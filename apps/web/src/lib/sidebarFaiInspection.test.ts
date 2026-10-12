import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SIDEBAR_FOLDERS, flattenSidebarLinks } from "../components/layout/sidebarStructure.ts";
import { EMPTY_SIDEBAR_SHORTCUTS } from "./sidebarShortcuts.ts";
import { resolveUserSidebar, type SidebarAccess } from "./sidebarUserLayout.ts";

function topBar(levels: Record<string, string>) {
  const access: SidebarAccess = { levels };
  return resolveUserSidebar(SIDEBAR_FOLDERS, EMPTY_SIDEBAR_SHORTCUTS, access);
}

describe("FAI & Inspection top-bar module", () => {
  it("shows for a user whose role grants fai.view, right after Quality", () => {
    const nodes = topBar({ "fai.view": "read" });
    const keys = nodes.map((n) => n.key);
    assert.ok(keys.includes("fai-inspection"), `top modules were: ${keys.join(", ")}`);
    const fai = nodes.find((n) => n.key === "fai-inspection")!;
    assert.equal(fai.label, "FAI & Inspection");
    assert.equal(fai.path, "/fai-inspection");
    const paths = flattenSidebarLinks([fai]).map((l) => l.path);
    for (const p of ["/fai-inspection/plans", "/fai-inspection/sources", "/fai-inspection/records", "/fai-inspection/random-pulls"]) {
      assert.ok(paths.includes(p), `missing ${p}`);
    }
    const all = SIDEBAR_FOLDERS.map((n) => n.key);
    assert.equal(all.indexOf("fai-inspection"), all.indexOf("quality") + 1);
  });

  it("is hidden without fai.view", () => {
    assert.ok(!topBar({ "fai.view": "none" }).some((n) => n.key === "fai-inspection"));
    assert.ok(!topBar({}).some((n) => n.key === "fai-inspection"));
  });
});
