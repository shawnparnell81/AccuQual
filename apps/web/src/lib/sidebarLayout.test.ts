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
    const moved = moveSidebarItem(start, "calendar", "quality", 0);
    assert.ok(moved);
    const quality = moved.find((item) => item.key === "quality");
    assert.equal(quality?.children?.[0]?.key, "calendar");
    assert.equal(moved.find((item) => item.key === "home")?.children?.some((child) => child.key === "calendar"), false);

    const nudged = nudgeSidebarItem(moved, "calendar", 1);
    assert.equal(nudged?.find((item) => item.key === "quality")?.children?.[1]?.key, "calendar");
  });

  it("refuses to put a section inside itself", () => {
    const start = defaultPlacements();
    assert.equal(moveSidebarItem(start, "quality", "quality", 0), null);
    assert.equal(moveSidebarItem(start, "document-control", "folder-explorer", 0), null);
  });

  it("pulls Quality back out when a saved layout nested it under Document Control", () => {
    const saved = defaultPlacements();
    const moved = moveSidebarItem(saved, "quality", "document-control", 0);
    assert.ok(moved);
    const applied = applySidebarLayout(moved);
    const keys = applied.map((item) => item.key);
    assert.equal(keys.indexOf("document-control"), keys.indexOf("quality") - 1);
    const control = applied.find((item) => item.key === "document-control");
    assert.ok(control && isFolder(control));
    assert.equal(control.children.some((child) => child.key === "quality"), false);
    assert.equal(control.children.some((child) => child.key === "training"), false);
  });

  it("keeps a saved order and still shows a new catalog item", () => {
    const saved = defaultPlacements();
    const home = saved.find((item) => item.key === "home");
    assert.ok(home?.children);
    home.children = home.children.filter((child) => child.key !== "calendar");
    const applied = applySidebarLayout(saved);
    const next = applied.find((item) => item.key === "home");
    assert.ok(next && isFolder(next));
    assert.ok(next.children.some((child) => child.key === "calendar"));
  });

  it("lifts a saved Document Control section above Quality and returns Quality folders to Quality", () => {
    const saved = defaultPlacements();
    const quality = saved.find((item) => item.key === "quality");
    const control = saved.find((item) => item.key === "document-control");
    assert.ok(quality?.children && control);
    saved.splice(saved.findIndex((item) => item.key === "document-control"), 1);
    const training = quality.children.find((child) => child.key === "training");
    quality.children = quality.children.filter((child) => child.key !== "training" && child.key !== "product-alerts");
    control.children = [...(control.children ?? []), ...(training ? [training] : []), { key: "product-alerts" }];
    quality.children.unshift(control);

    const applied = applySidebarLayout(saved);
    const keys = applied.map((item) => item.key);
    assert.equal(keys.indexOf("document-control"), keys.indexOf("quality") - 1);
    const nextControl = applied.find((item) => item.key === "document-control");
    const nextQuality = applied.find((item) => item.key === "quality");
    assert.ok(nextControl && isFolder(nextControl));
    assert.ok(nextQuality && isFolder(nextQuality));
    const catalog = SIDEBAR_FOLDERS.find((item) => item.key === "document-control");
    assert.ok(catalog && isFolder(catalog));
    assert.deepEqual(
      nextControl.children.map((child) => child.key),
      catalog.children.map((child) => child.key),
    );
    assert.equal(nextQuality.children.some((child) => child.key === "training"), true);
    assert.equal(nextQuality.children.some((child) => child.key === "product-alerts"), true);
    assert.equal(nextQuality.children.some((child) => child.key === "document-control"), false);
    assert.equal(applied.some((item) => item.key === "validation-reports"), false);
  });

  it("hides items the viewer cannot open after the admin rearranges them", () => {
    const start = placementsFromNodes(SIDEBAR_FOLDERS);
    const moved = moveSidebarItem(start, "admin", "home", 0);
    assert.ok(moved);
    const arranged = applySidebarLayout(moved);
    const forStaff = visibleSidebar(arranged, false, { auditLog: false });
    const home = forStaff.find((item) => item.key === "home");
    assert.ok(home && isFolder(home));
    assert.equal(home.children.some((child) => child.key === "admin"), false);
    assert.equal(forStaff.some((item) => item.key === "admin"), false);
    const labels = sidebarDestinations(arranged, "training").map((item) => item.label);
    assert.ok(labels.includes("Quality"));
    assert.ok(labels.includes("Documents"));
    assert.equal(labels.includes("Training"), false);
  });
});
