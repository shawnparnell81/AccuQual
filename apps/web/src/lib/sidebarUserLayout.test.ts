import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PERMANENT_SIDEBAR_LINKS, SIDEBAR_FOLDERS, flattenSidebarLinks, isFolder } from "../components/layout/sidebarStructure.ts";
import { EMPTY_SIDEBAR_SHORTCUTS } from "./sidebarShortcuts.ts";
import {
  addGroup,
  addPin,
  draftFromPrefs,
  draftToPrefs,
  layoutRows,
  moveDraftInto,
  moveDraftItem,
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
  it("renders the built-in menu, including Blank Forms, until someone customizes", () => {
    const shown = resolveUserSidebar(SIDEBAR_FOLDERS, EMPTY_SIDEBAR_SHORTCUTS, allowAll);
    assert.deepEqual(
      shown.map((node) => node.label),
      ["Home", "Documents", "Quality", "Engineering", "Equipment", "Suppliers", "Folders", "Reports", "Admin"],
    );
    const links = flattenSidebarLinks(shown);
    assert.equal(links.some((link) => link.key === "blank-forms" && link.path === "/blank-forms" && link.label === "Blank Forms"), true);
    assert.equal(links.some((link) => link.label === "First Article" || link.path === "/fai"), false);
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
    assert.equal(paths(allowAll, EMPTY_SIDEBAR_SHORTCUTS).some((row) => row.includes("|NCR|/ncr")), true);
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

  it("keeps a saved Blank Forms row on the Blank Forms page and drops a stale row", () => {
    const prefs = {
      hidden: [],
      pinned: [{ key: "pin-gone", label: "Retired page", path: "/not-a-real-page" }],
      groups: [],
      layout: [{ key: "blank-forms" }, { key: "ghost-menu" }, { key: "home", children: [{ key: "calendar" }] }],
    };
    const links = flattenSidebarLinks(resolveUserSidebar(SIDEBAR_FOLDERS, prefs, allowAll));
    assert.equal(links.some((link) => link.path === "/not-a-real-page" || link.key === "ghost-menu"), false);
    const blank = links.find((link) => link.key === "blank-forms");
    assert.equal(blank?.path, "/blank-forms");
    assert.equal(links.some((link) => link.key === "home"), true);
  });

  it("adds Blank Forms to a saved menu that does not have it, and leaves it off after a hide", () => {
    const added = flattenSidebarLinks(
      resolveUserSidebar(SIDEBAR_FOLDERS, { hidden: [], pinned: [], groups: [], layout: [{ key: "home" }, { key: "quality" }] }, allowAll),
    );
    assert.equal(added.some((link) => link.key === "blank-forms" && link.path === "/blank-forms"), true);
    assert.equal(resolveUserSidebar(SIDEBAR_FOLDERS, { hidden: [], pinned: [], groups: [], layout: [{ key: "home" }, { key: "quality" }] }, allowAll)[0]?.key, "home");

    const hidden = flattenSidebarLinks(
      resolveUserSidebar(
        SIDEBAR_FOLDERS,
        { hidden: ["blank-forms"], pinned: [], groups: [], layout: [{ key: "home" }, { key: "quality" }, { key: "blank-forms" }] },
        allowAll,
      ),
    );
    assert.equal(hidden.some((link) => link.key === "blank-forms"), false);
    const draft = draftFromPrefs(SIDEBAR_FOLDERS, { hidden: ["blank-forms"], pinned: [], groups: [], layout: [{ key: "home" }] });
    const rows = layoutRows(draft, SIDEBAR_FOLDERS);
    assert.equal(rows.find((row) => row.key === "home")?.locked, true);
    assert.equal(rows.some((row) => row.key === "blank-forms"), true);
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

    const removed = draftToPrefs(removePin(addPin(moved, { key: "pin-warranty-dashboard", label: "Warranty dashboard", path: "/warranty/dashboard" }), "pin-warranty-dashboard"));
    assert.equal(flattenSidebarLinks(resolveUserSidebar(SIDEBAR_FOLDERS, removed, allowAll)).some((link) => link.path === "/warranty/dashboard"), false);
    assert.equal(flattenSidebarLinks(resolveUserSidebar(SIDEBAR_FOLDERS, removed, allowAll)).some((link) => link.path === "/ncr"), true);

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

  it("puts Home back at the top when a saved layout hid it", () => {
    const prefs = {
      hidden: ["home", "document-control", "quality", "form-folders", "reporting", "calendar", "settings", "page-settings"],
      pinned: [
        { key: "pin-engineering-planner", label: "Engineering Planner", path: "https://mtollefson-rgb.github.io/Engineering-Planner/" },
        { key: "pin-master-document-list", label: "Master Document List", path: "/documents/master-list" },
      ],
      groups: [],
      layout: [
        { key: "my-shortcuts", children: [{ key: "pin-engineering-planner" }, { key: "pin-master-document-list" }] },
        { key: "fai" },
        { key: "repairs" },
        { key: "warranty" },
        { key: "recalls" },
        { key: "admin" },
      ],
    };
    const shown = resolveUserSidebar(SIDEBAR_FOLDERS, prefs, allowAll);
    assert.equal(shown[0]?.key, "home");
    assert.ok(isFolder(shown[0]!));
    assert.equal(shown[0].path, "/home");
    assert.ok(shown.findIndex((node) => node.key === "my-shortcuts") > 0);
    assert.equal(shown.some((node) => node.key === "fai"), false);
    assert.equal(flattenSidebarLinks(shown).some((link) => link.key === "blank-forms"), true);
    assert.equal(shown.some((node) => node.key === "quality"), true);
    assert.equal(shown.some((node) => node.key === "document-control"), true);
    assert.equal(shown.some((node) => node.key === "engineering"), true);
    assert.equal(shown.some((node) => node.key === "equipment"), true);
    assert.equal(shown.some((node) => node.key === "reporting"), true);
    assert.equal(flattenSidebarLinks(shown).some((link) => link.path === "/ncr"), true);
    assert.equal(flattenSidebarLinks(shown).some((link) => link.path === "/documents/folders"), true);
    assert.equal(flattenSidebarLinks(shown).some((link) => link.path === "/executive"), true);

    const unread = resolveUserSidebar(SIDEBAR_FOLDERS, prefs, { levels: null });
    assert.equal(unread[0]?.key, "home");
    assert.ok(isFolder(unread[0]!));
    assert.equal(unread[0].path, "/home");

    const draft = draftFromPrefs(SIDEBAR_FOLDERS, prefs);
    assert.equal(draft.layout[0]?.key, "home");
    assert.equal(draft.hidden.includes("home"), false);
    const rows = layoutRows(draft, SIDEBAR_FOLDERS);
    assert.equal(rows[0]?.key, "home");
    assert.equal(rows[0]?.locked, true);
    assert.equal(rows[0]?.hidden, false);
    assert.equal(toggleHidden(draft, "home"), draft);
    assert.equal(nudgeDraft(draft, "home", 1).layout[0]?.key, "home");
    assert.equal(moveDraftInto(draft, "home", "quality").layout[0]?.key, "home");
    const bumped = moveDraftItem(draft, "fai", null, 0);
    assert.equal(bumped.layout[0]?.key, "home");
    assert.notEqual(bumped.layout[1]?.key, "home");

    const saved = draftToPrefs(draft);
    assert.equal(saved.hidden.includes("home"), false);
    assert.equal(saved.layout?.[0]?.key, "home");
    assert.equal(resolveUserSidebar(SIDEBAR_FOLDERS, EMPTY_SIDEBAR_SHORTCUTS, allowAll)[0]?.key, "home");
  });

  it("lifts Home out of a section and keeps it first for a person who cannot open Admin", () => {
    const staff: SidebarAccess = {
      levels: new Proxy({} as Record<string, string>, { get: (_target, prop) => (prop === "admin_console" ? "none" : "edit") }),
    };
    const prefs = {
      hidden: [],
      pinned: [{ key: "pin-warranty-dashboard", label: "Warranty dashboard", path: "/warranty/dashboard" }],
      groups: [],
      layout: [{ key: "quality", children: [{ key: "home", children: [{ key: "calendar" }] }, { key: "fai" }] }, { key: "admin" }],
    };
    const shown = resolveUserSidebar(SIDEBAR_FOLDERS, prefs, staff);
    assert.equal(shown[0]?.key, "home");
    assert.ok(isFolder(shown[0]!));
    assert.equal(shown[0].children.some((child) => child.key === "calendar"), true);
    assert.equal(shown.some((node) => node.key === "admin"), false);
    const quality = shown.find((node) => node.key === "quality");
    assert.ok(!quality || (isFolder(quality) && !quality.children.some((child) => child.key === "home")));
    assert.ok(shown.findIndex((node) => node.key === "my-shortcuts") > 0);
  });

  it("leaves Settings on the permanent footer, outside the layout a person can hide", () => {
    const settings = PERMANENT_SIDEBAR_LINKS.find((link) => link.key === "settings");
    assert.equal(settings?.path, "/settings");
    assert.equal(settings?.label, "Settings");
    assert.equal(
      SIDEBAR_FOLDERS.some((node) => node.key === "settings" || ("path" in node && node.path === "/settings")),
      false,
    );
    const shown = resolveUserSidebar(
      SIDEBAR_FOLDERS,
      { hidden: ["settings", "page-settings"], pinned: [], groups: [], layout: [{ key: "fai" }] },
      allowAll,
    );
    assert.equal(shown[0]?.key, "home");
    assert.equal(PERMANENT_SIDEBAR_LINKS.some((link) => link.path === "/settings"), true);
  });

  it("hides Admin when the permissions payload does not grant the console", () => {
    const staff: SidebarAccess = {
      levels: new Proxy({} as Record<string, string>, { get: (_target, prop) => (prop === "admin_console" ? "none" : "edit") }),
    };
    const links = flattenSidebarLinks(resolveUserSidebar(SIDEBAR_FOLDERS, EMPTY_SIDEBAR_SHORTCUTS, staff));
    assert.equal(links.some((link) => link.key === "admin" || link.path === "/admin"), false);
    assert.equal(links.some((link) => link.key === "home"), true);
  });

  it("keeps a later hide of a group after the ERP menu edition", () => {
    const prefs = {
      hidden: ["quality"],
      pinned: [],
      groups: [],
      layout: [{ key: "home" }, { key: "quality" }, { key: "document-control" }],
      menuEdition: 2,
    };
    const shown = resolveUserSidebar(SIDEBAR_FOLDERS, prefs, allowAll);
    assert.equal(shown.some((node) => node.key === "quality"), false);
    assert.equal(shown.some((node) => node.key === "document-control"), true);
    const saved = draftToPrefs(draftFromPrefs(SIDEBAR_FOLDERS, prefs));
    assert.equal(saved.menuEdition, 2);
    assert.equal(saved.hidden.includes("quality"), true);
  });

  it("hides the executive dashboard when the role does not have it", () => {
    const staff: SidebarAccess = {
      levels: new Proxy({} as Record<string, string>, { get: (_target, prop) => (prop === "executive.dashboard" ? "none" : "edit") }),
    };
    const links = flattenSidebarLinks(resolveUserSidebar(SIDEBAR_FOLDERS, EMPTY_SIDEBAR_SHORTCUTS, staff));
    assert.equal(links.some((link) => link.path === "/executive"), false);
    assert.equal(links.some((link) => link.path === "/ncr"), true);
  });

  it("hides AI Insights when the company turns AI-assisted features off", () => {
    const links = flattenSidebarLinks(resolveUserSidebar(SIDEBAR_FOLDERS, EMPTY_SIDEBAR_SHORTCUTS, { ...allowAll, aiFeatures: false }));
    assert.equal(links.some((link) => link.key === "ai" || link.path === "/ai"), false);
    const on = flattenSidebarLinks(resolveUserSidebar(SIDEBAR_FOLDERS, EMPTY_SIDEBAR_SHORTCUTS, allowAll));
    assert.equal(on.some((link) => link.key === "ai"), true);
  });
});
