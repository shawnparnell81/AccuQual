import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SIDEBAR_FOLDERS, flattenSidebarLinks, isFolder } from "../components/layout/sidebarStructure.ts";
import { blankFormsFolderHref } from "./folderBrowse.ts";
import { EMPTY_SIDEBAR_SHORTCUTS } from "./sidebarShortcuts.ts";
import {
  BLANK_FORMS_PIN_KEY,
  addGroup,
  addPin,
  draftFromPrefs,
  draftToPrefs,
  moveDraftInto,
  nudgeDraft,
  readSidebarCache,
  removePin,
  resolveUserSidebar,
  toggleHidden,
  writeSidebarCache,
  type SidebarAccess,
} from "./sidebarUserLayout.ts";

const allowAll: SidebarAccess = {
  levels: new Proxy({} as Record<string, string>, { get: () => "edit" }),
};

function paths(access: SidebarAccess, prefs = EMPTY_SIDEBAR_SHORTCUTS) {
  return flattenSidebarLinks(resolveUserSidebar(SIDEBAR_FOLDERS, prefs, access)).map((link) => `${link.key}|${link.label}|${link.path}`);
}

describe("per-user sidebar layout", () => {
  it("renders the built-in menu, without Blank Forms, until someone customizes", () => {
    const shown = resolveUserSidebar(SIDEBAR_FOLDERS, EMPTY_SIDEBAR_SHORTCUTS, allowAll);
    assert.deepEqual(
      shown.map((node) => node.label),
      ["Home", "Documents", "Quality", "Folders", "Reports", "Admin"],
    );
    const links = flattenSidebarLinks(shown);
    assert.equal(links.some((link) => link.key === "blank-forms" || link.path === "/blank-forms" || link.label === "Blank Forms"), false);
    assert.equal(links.some((link) => link.key === "frm-ncr-001"), true);
    assert.equal(links.some((link) => link.key === "folder-explorer"), true);
  });

  it("hides, reorders, and pins, and the same menu comes back after a reload", () => {
    let draft = draftFromPrefs(SIDEBAR_FOLDERS, EMPTY_SIDEBAR_SHORTCUTS);
    draft = toggleHidden(draft, "pareto");
    draft = moveDraftInto(draft, "calendar", "quality");
    draft = nudgeDraft(draft, "calendar", 1);
    draft = addPin(draft, { key: "pin-fmea", label: "FMEA", path: "/risk" });
    const saved = JSON.parse(JSON.stringify(draftToPrefs(draft)));
    const first = paths(allowAll, saved);
    const reloaded = paths(allowAll, saved);
    assert.deepEqual(reloaded, first);
    assert.equal(first.some((row) => row.startsWith("pareto|")), false);
    assert.equal(first.some((row) => row.includes("|FMEA|/risk")), true);

    const quality = resolveUserSidebar(SIDEBAR_FOLDERS, saved, allowAll).find((node) => node.key === "quality");
    assert.ok(quality && isFolder(quality));
    assert.equal(quality.children.some((child) => child.key === "calendar"), true);
    const home = resolveUserSidebar(SIDEBAR_FOLDERS, saved, allowAll).find((node) => node.key === "home");
    assert.ok(home && isFolder(home));
    assert.equal(home.children.some((child) => child.key === "calendar"), false);
  });

  it("reset restores the built-in menu", () => {
    const custom = draftToPrefs(addPin(toggleHidden(draftFromPrefs(SIDEBAR_FOLDERS, EMPTY_SIDEBAR_SHORTCUTS), "training"), { key: "pin-ncr", label: "NCR", path: "/ncr" }));
    assert.equal(paths(allowAll, custom).some((row) => row.startsWith("training|")), false);
    assert.deepEqual(paths(allowAll, EMPTY_SIDEBAR_SHORTCUTS), paths(allowAll, { hidden: [], pinned: [], layout: null, groups: [] }));
    assert.equal(paths(allowAll, EMPTY_SIDEBAR_SHORTCUTS).some((row) => row.startsWith("training|")), true);
    assert.equal(paths(allowAll, EMPTY_SIDEBAR_SHORTCUTS).some((row) => row.includes("|NCR|")), false);
  });

  it("hides a pinned page when that module is forbidden", () => {
    const denied: SidebarAccess = {
      levels: new Proxy({} as Record<string, string>, { get: (_target, prop) => (prop === "capa" || prop === "risk" ? "none" : "edit") }),
    };
    const prefs = draftToPrefs(addPin(draftFromPrefs(SIDEBAR_FOLDERS, EMPTY_SIDEBAR_SHORTCUTS), { key: "pin-fmea", label: "FMEA", path: "/risk" }));
    const links = flattenSidebarLinks(resolveUserSidebar(SIDEBAR_FOLDERS, prefs, denied));
    assert.equal(links.some((link) => link.key === "capa" || link.path === "/capa"), false);
    assert.equal(links.some((link) => link.key === "pin-fmea" || link.path === "/risk"), false);
    assert.equal(links.some((link) => link.key === "frm-ncr-001"), true);
    assert.equal(links.some((link) => link.key === "8d"), true);
  });

  it("skips a stale row and sends an old Blank Forms entry to Blank Forms Templates", () => {
    const prefs = {
      hidden: [],
      pinned: [{ key: "pin-gone", label: "Retired page", path: "/not-a-real-page" }],
      groups: [],
      layout: [{ key: "blank-forms" }, { key: "ghost-menu" }, { key: "home", children: [{ key: "calendar" }] }],
    };
    const links = flattenSidebarLinks(resolveUserSidebar(SIDEBAR_FOLDERS, prefs, allowAll));
    assert.equal(links.some((link) => link.path === "/not-a-real-page" || link.key === "ghost-menu" || link.path === "/blank-forms"), false);
    const blank = links.find((link) => link.key === BLANK_FORMS_PIN_KEY);
    assert.equal(blank?.path, blankFormsFolderHref());
    assert.equal(links.some((link) => link.key === "home"), true);
  });

  it("keeps a custom section and remembers it in the browser cache", () => {
    const draft = addGroup(draftFromPrefs(SIDEBAR_FOLDERS, EMPTY_SIDEBAR_SHORTCUTS), "Shop floor", "group:shop-floor");
    const moved = moveDraftInto(draft, "training", "group:shop-floor");
    const prefs = draftToPrefs(moved);
    const shown = resolveUserSidebar(SIDEBAR_FOLDERS, prefs, allowAll);
    const section = shown.find((node) => node.key === "group:shop-floor");
    assert.ok(section && isFolder(section));
    assert.equal(section.label, "Shop floor");
    assert.equal(section.children.some((child) => child.key === "training"), true);

    const removed = draftToPrefs(removePin(addPin(moved, { key: "pin-ncr", label: "NCR", path: "/ncr" }), "pin-ncr"));
    assert.equal(flattenSidebarLinks(resolveUserSidebar(SIDEBAR_FOLDERS, removed, allowAll)).some((link) => link.path === "/ncr"), false);

    const memory = new Map<string, string>();
    const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value) };
    writeSidebarCache(storage, 7, { prefs, levels: { ncr: "read", admin_console: "none" } });
    const cached = readSidebarCache(storage, 7);
    assert.equal(cached?.prefs.groups?.[0]?.label, "Shop floor");
    assert.equal(cached?.levels?.ncr, "read");
    assert.equal(readSidebarCache(storage, 8), null);
    writeSidebarCache(storage, 7, { prefs: EMPTY_SIDEBAR_SHORTCUTS });
    assert.equal(readSidebarCache(storage, 7)?.levels?.admin_console, "none");
  });

  it("hides Admin when the permissions payload does not grant the console", () => {
    const staff: SidebarAccess = {
      levels: new Proxy({} as Record<string, string>, { get: (_target, prop) => (prop === "admin_console" ? "none" : "edit") }),
    };
    const links = flattenSidebarLinks(resolveUserSidebar(SIDEBAR_FOLDERS, EMPTY_SIDEBAR_SHORTCUTS, staff));
    assert.equal(links.some((link) => link.key === "admin" || link.path === "/admin"), false);
    assert.equal(links.some((link) => link.key === "home"), true);
  });
});
