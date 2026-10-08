import { describe, expect, it } from "vitest";
import { emptySidebarShortcuts, normalizeSidebarShortcuts } from "../../src/modules/users/sidebarPrefs.js";

describe("sidebar shortcut normalization", () => {
  it("puts Home back at the top when a saved layout left it out", () => {
    const next = normalizeSidebarShortcuts({
      hidden: ["home", "fai"],
      pinned: [{ key: "pin-master-document-list", label: "Master Document List", path: "/documents/master-list" }],
      groups: [],
      layout: [{ key: "my-shortcuts", children: [{ key: "pin-master-document-list" }] }, { key: "fai" }, { key: "repairs" }],
    });
    expect(next.hidden).not.toContain("home");
    expect(next.hidden).toContain("fai");
    expect(next.layout?.[0]?.key).toBe("home");
    expect(next.layout?.some((node) => node.key === "fai")).toBe(true);
    expect(next.pinned.map((pin) => pin.key)).toEqual(["pin-master-document-list"]);
  });

  it("lifts a nested Home and keeps its children", () => {
    const next = normalizeSidebarShortcuts({
      hidden: [],
      pinned: [],
      layout: [{ key: "quality", children: [{ key: "home", children: [{ key: "calendar" }] }, { key: "fai" }] }],
    });
    expect(next.layout?.[0]).toEqual({ key: "home", children: [{ key: "calendar" }] });
    expect(next.layout?.[1]?.key).toBe("quality");
    expect(next.layout?.[1]?.children?.some((child) => child.key === "home")).toBe(false);
  });

  it("leaves the built-in menu as a null layout and still clears a hidden Home", () => {
    const next = normalizeSidebarShortcuts({ hidden: ["home"], pinned: [], layout: null, groups: [] });
    expect(next.layout).toBeNull();
    expect(next.hidden).toEqual([]);
    expect(emptySidebarShortcuts()).toEqual({ hidden: [], pinned: [], layout: null, groups: [] });
  });
});
