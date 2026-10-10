import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SIDEBAR_FOLDERS, flattenSidebarLinks, isFolder, PERMANENT_SIDEBAR_LINKS } from "../components/layout/sidebarStructure.ts";
import { acceptSidebarPath, filterSidebarByAccess, type SidebarAccess } from "./sidebarAccess.ts";
import { collapseSingleItemMenus, developmentMenu, folderMenuEntries, menuLabels, siteShowsDevelopment, withDevelopment } from "./navigationLayout.ts";

const allowAll: SidebarAccess = {
  levels: new Proxy({} as Record<string, string>, { get: () => "edit" }),
};

function levels(map: Record<string, string>): SidebarAccess {
  return { levels: new Proxy({} as Record<string, string>, { get: (_target, prop) => map[String(prop)] ?? "none" }) };
}

describe("top menu", () => {
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
    const engineering = wellman.find((node) => node.key === "engineering");
    assert.ok(engineering && isFolder(engineering));
    const dev = engineering.children.find((node) => node.key === "development");
    assert.ok(dev && isFolder(dev));
    assert.equal(wellman.some((node) => node.key === "development"), false);
    const withoutDev = withDevelopment(wellman, []);
    assert.deepEqual(menuLabels(withoutDev), menuLabels(SIDEBAR_FOLDERS));
    assert.equal(dev.children.some((child) => child.key === "development-log"), true);
    assert.equal(dev.children.some((child) => "path" in child && child.path === "/iso-forms/frm-dev-001"), true);
    assert.equal(dev.children.some((child) => "path" in child && child.path === "/iso-forms/rpt-eng-001"), true);
    assert.equal(dev.children.length, 15);
  });

  it("keeps every current sidebar section, including pages a folder itself opens", () => {
    const labels = menuLabels(SIDEBAR_FOLDERS);
    for (const required of ["Home", "Documents", "Blank Forms", "Quality", "Engineering", "Equipment", "Suppliers", "Folders", "Reports", "Admin", "Calendar", "Executive dashboard", "NCR", "FRM NCR", "CAPA", "Engineering Planner", "Folder Explorer", "Controlled lists"]) {
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

  it("turns a one-item submenu into a direct link and keeps real groups", () => {
    const quality = SIDEBAR_FOLDERS.find((node) => node.key === "quality");
    const equipment = SIDEBAR_FOLDERS.find((node) => node.key === "equipment");
    const suppliers = SIDEBAR_FOLDERS.find((node) => node.key === "suppliers");
    assert.ok(quality && isFolder(quality));
    assert.ok(equipment && isFolder(equipment));
    assert.ok(suppliers && isFolder(suppliers));

    const ncr = quality.children.find((node) => node.key === "ncr-capa");
    assert.ok(ncr && isFolder(ncr));
    const ncrShown = collapseSingleItemMenus(ncr);
    assert.ok(isFolder(ncrShown));
    assert.deepEqual(
      ncrShown.children.map((child) => child.label),
      ["NCR", "FRM NCR", "CAPA", "8D"],
    );

    const supplierShown = collapseSingleItemMenus(suppliers);
    assert.ok(isFolder(supplierShown));
    assert.deepEqual(
      folderMenuEntries(supplierShown).map((child) => child.label),
      ["Suppliers", "ADD SUPPLIER", "Supplier Portal", "SCAR"],
    );

    const calibration = equipment.children.find((node) => node.key === "calibration");
    assert.ok(calibration && isFolder(calibration));
    const calibrationOnly = collapseSingleItemMenus({ ...calibration, children: [] });
    assert.equal(isFolder(calibrationOnly), false);
    if (!isFolder(calibrationOnly)) {
      assert.equal(calibrationOnly.label, "Calibration");
      assert.equal(calibrationOnly.path, "/calibration");
    }

    const audits = quality.children.find((node) => node.key === "audits");
    assert.ok(audits && isFolder(audits));
    const auditsOnly = collapseSingleItemMenus({ ...audits, children: [] });
    assert.equal(isFolder(auditsOnly), false);
    if (!isFolder(auditsOnly)) assert.equal(auditsOnly.path, "/audits");

    const ncrOnly = collapseSingleItemMenus({
      ...ncr,
      children: ncr.children.filter((child) => child.key === "ncr"),
    });
    assert.equal(isFolder(ncrOnly), false);
    if (!isFolder(ncrOnly)) {
      assert.equal(ncrOnly.label, "NCR & CAPA");
      assert.equal(ncrOnly.path, "/ncr");
    }

    const equipmentOnly = collapseSingleItemMenus({
      ...equipment,
      children: [{ ...calibration, children: [] }],
    });
    assert.equal(isFolder(equipmentOnly), false);
    if (!isFolder(equipmentOnly)) {
      assert.equal(equipmentOnly.label, "Equipment");
      assert.equal(equipmentOnly.path, "/calibration");
    }

    const kept = collapseSingleItemMenus(calibration);
    assert.ok(isFolder(kept));
    assert.equal(folderMenuEntries(kept).some((child) => "path" in child && child.path === "/calibration/master-list"), true);
  });
});
