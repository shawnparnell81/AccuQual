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
    expect(next.offered).toEqual(["blank-forms"]);
    expect(emptySidebarShortcuts()).toEqual({ hidden: [], pinned: [], layout: null, groups: [], offered: [] });
  });

  it("appends Blank Forms to a saved menu the first time, and keeps a later hide", () => {
    const first = normalizeSidebarShortcuts({
      hidden: ["blank-forms"],
      pinned: [],
      layout: [{ key: "home" }, { key: "quality" }],
      groups: [],
    });
    expect(first.hidden).not.toContain("blank-forms");
    expect(first.layout?.some((node) => node.key === "blank-forms")).toBe(true);
    expect(first.layout?.[0]?.key).toBe("home");
    expect(first.offered).toContain("blank-forms");

    const hidden = normalizeSidebarShortcuts({
      hidden: ["blank-forms"],
      pinned: [],
      layout: [{ key: "home" }, { key: "quality" }],
      groups: [],
      offered: ["blank-forms"],
    });
    expect(hidden.hidden).toContain("blank-forms");
    expect(hidden.layout?.some((node) => node.key === "blank-forms")).toBe(false);
    expect(hidden.layout?.[0]?.key).toBe("home");
  });

  it("keeps a menu edition and drops one that is not a small number", () => {
    const kept = normalizeSidebarShortcuts({ hidden: [], pinned: [], layout: null, groups: [], menuEdition: 2 });
    expect(kept.menuEdition).toBe(2);
    const dropped = normalizeSidebarShortcuts({ hidden: [], pinned: [], layout: null, groups: [], menuEdition: 99 });
    expect(dropped.menuEdition).toBeUndefined();
  });
});
