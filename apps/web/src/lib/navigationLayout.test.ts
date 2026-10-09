import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SIDEBAR_FOLDERS, flattenSidebarLinks, isFolder, PERMANENT_SIDEBAR_LINKS } from "../components/layout/sidebarStructure.ts";
import { acceptSidebarPath, filterSidebarByAccess, type SidebarAccess } from "./sidebarAccess.ts";
import { developmentMenu, folderMenuEntries, menuLabels, navigationLayoutFromProfile, siteShowsDevelopment, withDevelopment } from "./navigationLayout.ts";

const allowAll: SidebarAccess = {
  levels: new Proxy({} as Record<string, string>, { get: () => "edit" }),
};

function levels(map: Record<string, string>): SidebarAccess {
  return { levels: new Proxy({} as Record<string, string>, { get: (_target, prop) => map[String(prop)] ?? "none" }) };
}

describe("navigation layout", () => {
  it("defaults to the sidebar", () => {
    assert.equal(navigationLayoutFromProfile(undefined), "sidebar");
    assert.equal(navigationLayoutFromProfile(null), "sidebar");
    assert.equal(navigationLayoutFromProfile("sidebar"), "sidebar");
    assert.equal(navigationLayoutFromProfile("left"), "sidebar");
    assert.equal(navigationLayoutFromProfile("top"), "top");
  });

  it("shows development for Wellman and All sites, and the same menu otherwise", () => {
    assert.equal(siteShowsDevelopment("Greer", null), false);
    assert.equal(siteShowsDevelopment("Wellman", null), true);
    assert.equal(siteShowsDevelopment(" wellman ", null), true);
    assert.equal(siteShowsDevelopment("Greer", "all"), true);
    assert.equal(siteShowsDevelopment(null, null), false);

    const shared = withDevelopment(SIDEBAR_FOLDERS, []);
    assert.equal(shared.some((node) => node.key === "development"), false);
    assert.deepEqual(menuLabels(shared), menuLabels(SIDEBAR_FOLDERS));

    const wellman = withDevelopment(SIDEBAR_FOLDERS, filterSidebarByAccess([developmentMenu()], allowAll));
    const dev = wellman.find((node) => node.key === "development");
    assert.ok(dev && isFolder(dev));
    assert.equal(wellman.findIndex((node) => node.key === "development") + 1, wellman.findIndex((node) => node.key === "reporting"));
    const withoutDev = wellman.filter((node) => node.key !== "development");
    assert.deepEqual(menuLabels(withoutDev), menuLabels(SIDEBAR_FOLDERS));
    assert.equal(dev.children.some((child) => child.key === "development-log"), true);
    assert.equal(dev.children.some((child) => "path" in child && child.path === "/iso-forms/frm-dev-001"), true);
    assert.equal(dev.children.some((child) => "path" in child && child.path === "/iso-forms/rpt-eng-001"), true);
    assert.equal(dev.children.length, 15);
  });

  it("keeps every current sidebar section, including pages a folder itself opens", () => {
    const labels = menuLabels(SIDEBAR_FOLDERS);
    for (const required of ["Home", "Documents", "Blank Forms", "Quality", "Folders", "Reports", "Admin", "Calendar", "FRM NCR", "CAPA", "Engineering Planner"]) {
      assert.equal(labels.includes(required), true, required);
    }
    assert.equal(PERMANENT_SIDEBAR_LINKS.some((link) => link.label === "Settings" && link.path === "/settings"), true);
    const home = SIDEBAR_FOLDERS.find((node) => node.key === "home");
    assert.ok(home && isFolder(home));
    const entries = folderMenuEntries(home);
    assert.equal(entries[0] && "path" in entries[0] && entries[0].path, "/home");
    assert.equal(entries.some((node) => node.key === "calendar"), true);
  });

  it("hides development and admin rows the person cannot open", () => {
    const noDocs = filterSidebarByAccess([developmentMenu()], levels({ qms_forms: "edit" }));
    assert.equal(flattenSidebarLinks(noDocs).some((link) => link.path === "/documents/development-log"), false);
    assert.equal(flattenSidebarLinks(noDocs).some((link) => link.path === "/iso-forms/frm-dev-013"), true);

    const noForms = filterSidebarByAccess([developmentMenu()], levels({ documents: "read" }));
    const left = flattenSidebarLinks(noForms);
    assert.deepEqual(left.map((link) => link.path), ["/documents/development-log"]);

    const none = filterSidebarByAccess([developmentMenu()], levels({}));
    assert.equal(none.length, 0);

    const staff = filterSidebarByAccess(SIDEBAR_FOLDERS, levels({}));
    assert.equal(flattenSidebarLinks(staff).some((link) => link.key === "admin" || link.path === "/admin"), false);
    assert.equal(acceptSidebarPath("/documents/development-log"), "/documents/development-log");
    assert.equal(acceptSidebarPath("/iso-forms/frm-dev-001"), "/iso-forms/frm-dev-001");
  });
});
