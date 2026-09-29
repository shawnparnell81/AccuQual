import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SIDEBAR_FOLDERS, isFolder, visibleSidebar } from "../components/layout/sidebarStructure.ts";
import { applySidebarLayout, defaultPlacements, moveSidebarItem, nudgeSidebarItem, placementsFromNodes, sidebarDestinations } from "./sidebarLayout.ts";

describe("sidebar layout", () => {
  it("starts from the built-in order", () => {
    const placements = defaultPlacements();
    assert.deepEqual(
      placements.map((item) => item.key),
      SIDEBAR_FOLDERS.map((item) => item.key),
    );
    const quality = placements.find((item) => item.key === "quality");
    assert.ok(quality?.children?.some((child) => child.key === "ncr-capa"));
  });

  it("moves an item into another section and reorders it", () => {
    const start = defaultPlacements();
    const moved = moveSidebarItem(start, "training", "engineering", 0);
    assert.ok(moved);
    const engineering = moved.find((item) => item.key === "engineering");
    assert.equal(engineering?.children?.[0]?.key, "training");
    assert.equal(moved.find((item) => item.key === "quality")?.children?.some((child) => child.key === "training"), false);

    const nudged = nudgeSidebarItem(moved, "training", 1);
    assert.equal(nudged?.find((item) => item.key === "engineering")?.children?.[1]?.key, "training");
  });

  it("refuses to put a section inside itself", () => {
    const start = defaultPlacements();
    assert.equal(moveSidebarItem(start, "quality", "document-control", 0), null);
    assert.equal(moveSidebarItem(start, "quality", "quality", 0), null);
  });

  it("keeps a saved order and still shows a new catalog item", () => {
    const saved = defaultPlacements();
    const workspace = saved.find((item) => item.key === "workspace");
    assert.ok(workspace?.children);
    workspace.children = workspace.children.filter((child) => child.key !== "calendar");
    const applied = applySidebarLayout(saved);
    const home = applied.find((item) => item.key === "workspace");
    assert.ok(home && isFolder(home));
    assert.ok(home.children.some((child) => child.key === "calendar"));
    assert.equal(home.children[0]?.key, "home");
  });

  it("hides items the viewer cannot open after the admin rearranges them", () => {
    const start = placementsFromNodes(SIDEBAR_FOLDERS);
    const moved = moveSidebarItem(start, "admin", "workspace", 0);
    assert.ok(moved);
    const arranged = applySidebarLayout(moved);
    const forStaff = visibleSidebar(arranged, false, { auditLog: false });
    const workspace = forStaff.find((item) => item.key === "workspace");
    assert.ok(workspace && isFolder(workspace));
    assert.equal(workspace.children.some((child) => child.key === "admin"), false);
    const labels = sidebarDestinations(arranged, "training").map((item) => item.label);
    assert.ok(labels.includes("Engineering"));
    assert.equal(labels.includes("Training"), false);
  });
});
