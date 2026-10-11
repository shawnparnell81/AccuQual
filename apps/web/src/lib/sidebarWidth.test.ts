import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SIDEBAR_FOLDERS, isFolder, type SidebarNode } from "../components/layout/sidebarStructure.ts";
import {
  SIDEBAR_CONTENT_RESERVE,
  SIDEBAR_NARROW_BREAKPOINT,
  SIDEBAR_RAIL_WIDTH,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_KEY,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  appliedSidebarWidth,
  clampSidebarWidth,
  dragViewport,
  maxSidebarWidth,
  readSidebarWidth,
  sidebarFitWidth,
  sidebarNavPixels,
  widthAfterDoubleClick,
  widthAfterDrag,
  writeSidebarWidth,
  type SidebarWidthStorage,
} from "./sidebarWidth.ts";

function memoryStorage(initial?: Record<string, string>): SidebarWidthStorage & { dump: () => Record<string, string> } {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    dump: () => Object.fromEntries(map),
  };
}

function longestLabel(nodes: SidebarNode[]): string {
  let longest = "";
  for (const node of nodes) {
    if (node.label.length > longest.length) longest = node.label;
    if (isFolder(node)) {
      const nested = longestLabel(node.children);
      if (nested.length > longest.length) longest = nested;
    }
  }
  return longest;
}

describe("sidebar width", () => {
  it("defaults when nothing is saved and ignores junk", () => {
    assert.equal(readSidebarWidth(memoryStorage()), SIDEBAR_WIDTH_DEFAULT);
    assert.equal(readSidebarWidth(memoryStorage({ [SIDEBAR_WIDTH_KEY]: "" })), SIDEBAR_WIDTH_DEFAULT);
    assert.equal(readSidebarWidth(memoryStorage({ [SIDEBAR_WIDTH_KEY]: "nope" })), SIDEBAR_WIDTH_DEFAULT);
    assert.equal(readSidebarWidth(null), SIDEBAR_WIDTH_DEFAULT);
    const broken: SidebarWidthStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    assert.equal(readSidebarWidth(broken), SIDEBAR_WIDTH_DEFAULT);
    writeSidebarWidth(broken, 320);
  });

  it("clamps to the min and max and rounds", () => {
    assert.equal(clampSidebarWidth(80), SIDEBAR_WIDTH_MIN);
    assert.equal(clampSidebarWidth(900), SIDEBAR_WIDTH_MAX);
    assert.equal(clampSidebarWidth(319.4), 319);
    assert.equal(clampSidebarWidth(Number.NaN), SIDEBAR_WIDTH_DEFAULT);
  });

  it("leaves room for the page on a shorter window", () => {
    const viewport = SIDEBAR_WIDTH_MAX + SIDEBAR_CONTENT_RESERVE - 80;
    assert.equal(maxSidebarWidth(viewport), SIDEBAR_WIDTH_MAX - 80);
    assert.equal(clampSidebarWidth(SIDEBAR_WIDTH_MAX, viewport), SIDEBAR_WIDTH_MAX - 80);
    assert.ok(maxSidebarWidth(viewport) <= viewport - SIDEBAR_CONTENT_RESERVE);
  });

  it("saves a width and reads it back", () => {
    const storage = memoryStorage();
    writeSidebarWidth(storage, 360.2);
    assert.equal(storage.dump()[SIDEBAR_WIDTH_KEY], "360");
    assert.equal(readSidebarWidth(storage), 360);
    writeSidebarWidth(storage, 40);
    assert.equal(readSidebarWidth(storage), SIDEBAR_WIDTH_MIN);
  });

  it("does not apply a saved width on the icon rail or a narrow screen", () => {
    assert.equal(appliedSidebarWidth(360, 1400, false), 360);
    assert.equal(appliedSidebarWidth(360, 1400, true), null);
    assert.equal(appliedSidebarWidth(360, SIDEBAR_NARROW_BREAKPOINT, false), null);
    assert.equal(appliedSidebarWidth(80, 1400, false), SIDEBAR_WIDTH_MIN);
  });

  it("drags the panel and only leaves the rail once the minimum is reached", () => {
    assert.deepEqual(widthAfterDrag(252, 80, 1400, false), { width: 332, collapsed: false });
    assert.deepEqual(widthAfterDrag(252, -80, 1400, false), { width: SIDEBAR_WIDTH_MIN, collapsed: false });
    assert.deepEqual(widthAfterDrag(252, 400, 1400, false), { width: SIDEBAR_WIDTH_MAX, collapsed: false });
    assert.deepEqual(widthAfterDrag(SIDEBAR_RAIL_WIDTH, 40, 1400, true), { width: SIDEBAR_RAIL_WIDTH, collapsed: true });
    assert.deepEqual(widthAfterDrag(SIDEBAR_RAIL_WIDTH, 200, 1400, true), { width: 272, collapsed: false });
  });

  it("puts the expanded width on the nav box, including the narrow-screen drawer", () => {
    assert.equal(sidebarNavPixels(400, 1400, false), 400);
    assert.equal(sidebarNavPixels(400, 1400, true), null);
    assert.equal(sidebarNavPixels(400, 800, false), 400);
    assert.equal(dragViewport(800), 900);
    assert.equal(dragViewport(1400), 1400);
  });

  it("double-click toggles the default and a width that fits long titles", () => {
    const labels = ["Master Equipment List", "Management System", "Document Control", "Master Document Register"];
    const fit = sidebarFitWidth(labels, 1400);
    assert.ok(fit > SIDEBAR_WIDTH_DEFAULT, `fit ${fit} should clear the default`);
    assert.ok(fit <= SIDEBAR_WIDTH_MAX);
    assert.equal(widthAfterDoubleClick(SIDEBAR_WIDTH_DEFAULT, fit), fit);
    assert.equal(widthAfterDoubleClick(fit, fit), SIDEBAR_WIDTH_DEFAULT);
    assert.equal(widthAfterDoubleClick(SIDEBAR_WIDTH_DEFAULT + 4, fit), fit);
  });

  it("fits the longest nav title at the maximum width", () => {
    const label = longestLabel(SIDEBAR_FOLDERS);
    assert.equal(label, "Quality Objectives & KPIs");
    // Padding, admin grip, icon, gap, chevron, and one level of nesting.
    const chrome = 160;
    const charPx = 8;
    assert.ok(SIDEBAR_WIDTH_MAX - chrome >= label.length * charPx, `${label} clips at ${SIDEBAR_WIDTH_MAX}px`);
    assert.ok(SIDEBAR_WIDTH_DEFAULT - chrome < label.length * charPx);
  });
});
