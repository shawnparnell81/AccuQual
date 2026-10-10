import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SIDEBAR_FOLDERS, flattenSidebarLinks, isFolder } from "../components/layout/sidebarStructure.ts";
import { faiValidationDocumentsHref, LEGACY_VALIDATION_REPORTS_PATH } from "./folderBrowse.ts";
import { applyUserShortcuts, PINNABLE_SHORTCUTS } from "./sidebarShortcuts.ts";

describe("per-user sidebar shortcuts", () => {
  it("leaves the shared menu alone until someone hides or pins", () => {
    const next = applyUserShortcuts(SIDEBAR_FOLDERS, { hidden: [], pinned: [] });
    assert.equal(next.some((node) => node.key === "my-shortcuts"), false);
    assert.deepEqual(
      flattenSidebarLinks(next)
        .filter((link) => link.path.startsWith("/iso-forms/"))
        .map((link) => link.path),
      ["/iso-forms/frm-ncr-001"],
    );
    assert.equal(flattenSidebarLinks(next).some((link) => link.path === "/ncr"), true);
    assert.equal(PINNABLE_SHORTCUTS.some((item) => item.label === "FMEA"), true);
  });

  it("keeps Home first when a pin would otherwise lead the menu", () => {
    const next = applyUserShortcuts(SIDEBAR_FOLDERS, {
      hidden: ["home"],
      pinned: [{ key: "pin-warranty-dashboard", label: "Warranty dashboard", path: "/warranty/dashboard" }],
    });
    assert.equal(next[0]?.key, "home");
    assert.equal(next[1]?.key, "my-shortcuts");
    assert.equal(flattenSidebarLinks(next).some((link) => link.path === "/home"), true);
  });

  it("hides a shared item and pins a page that is not already showing", () => {
    const next = applyUserShortcuts(SIDEBAR_FOLDERS, {
      hidden: ["pareto", "risk"],
      pinned: [{ key: "pin-fmea", label: "FMEA", path: "/risk" }],
    });
    assert.equal(flattenSidebarLinks(next).some((link) => link.key === "pareto"), false);
    const shortcuts = next.find((node) => node.key === "my-shortcuts");
    assert.ok(shortcuts && isFolder(shortcuts));
    assert.deepEqual(
      shortcuts.children.map((child) => child.label),
      ["FMEA"],
    );
  });

  it("does not pin a second copy of a page that is already on the menu", () => {
    const next = applyUserShortcuts(SIDEBAR_FOLDERS, {
      hidden: [],
      pinned: [{ key: "pin-capa", label: "CAPA", path: "/capa" }],
    });
    assert.equal(next.some((node) => node.key === "my-shortcuts"), false);
    assert.equal(flattenSidebarLinks(next).filter((link) => link.path === "/capa").length, 1);
  });

  it("hides Engineering Planner for one person and leaves the rest of the menu", () => {
    const next = applyUserShortcuts(SIDEBAR_FOLDERS, {
      hidden: ["engineering-planner"],
      pinned: [],
    });
    const links = flattenSidebarLinks(next);
    assert.equal(links.some((link) => link.key === "engineering-planner"), false);
    assert.equal(links.some((link) => link.key === "drawings"), true);
    assert.equal(links.some((link) => link.key === "frm-ncr-001"), true);
    assert.equal(links.some((link) => link.key === "capa"), true);
    assert.equal(links.some((link) => link.key === "blank-forms" && link.path === "/blank-forms"), true);
    assert.equal(links.some((link) => link.label === "First Article" || link.path === "/fai"), false);
    assert.equal(links.some((link) => link.path === "/ncr"), true);
  });

  it("keeps one Blank Forms entry when a pin points at the same page", () => {
    const next = applyUserShortcuts(SIDEBAR_FOLDERS, {
      hidden: [],
      pinned: [{ key: "pin-blanks", label: "Blank Forms", path: "/blank-forms" }],
    });
    assert.equal(next.some((node) => node.key === "my-shortcuts"), false);
    assert.equal(flattenSidebarLinks(next).filter((link) => link.path === "/blank-forms").length, 1);
    assert.equal(flattenSidebarLinks(next).find((link) => link.path === "/blank-forms")?.key, "blank-forms");
  });

  it("sends a saved Validation Reports shortcut to FAI / Validation", () => {
    const next = applyUserShortcuts(SIDEBAR_FOLDERS, {
      hidden: [],
      pinned: [{ key: "pin-validation", label: "Validation Reports", path: LEGACY_VALIDATION_REPORTS_PATH }],
    });
    const shortcuts = next.find((node) => node.key === "my-shortcuts");
    assert.ok(shortcuts && isFolder(shortcuts));
    assert.equal(shortcuts.children[0] && "path" in shortcuts.children[0] ? shortcuts.children[0].path : "", faiValidationDocumentsHref());
    assert.equal(flattenSidebarLinks(next).some((link) => link.path === LEGACY_VALIDATION_REPORTS_PATH), false);
  });

  it("drops a pinned Master Document Register blank and keeps Master Document List", () => {
    const next = applyUserShortcuts(SIDEBAR_FOLDERS, {
      hidden: [],
      pinned: [
        { key: "blank:master_document_register", label: "Master Document Register", path: "/qms-forms/master_document_register" },
        { key: "pin-master-document-list", label: "Master Document List", path: "/documents/master-list" },
      ],
    });
    const links = flattenSidebarLinks(next);
    assert.equal(links.some((link) => link.label === "Master Document Register" || link.path === "/qms-forms/master_document_register"), false);
    assert.equal(links.some((link) => link.label === "Master Document List" && link.path === "/documents/master-list"), true);
    assert.equal(PINNABLE_SHORTCUTS.some((item) => item.path === "/documents/master-list"), true);
  });

  it("keeps the live NCR module on the shared menu and does not pin a second copy", () => {
    const next = applyUserShortcuts(SIDEBAR_FOLDERS, {
      hidden: [],
      pinned: [{ key: "pin-ncr", label: "NCR", path: "/ncr" }],
    });
    assert.equal(next.some((node) => node.key === "my-shortcuts"), false);
    assert.equal(flattenSidebarLinks(next).filter((link) => link.path === "/ncr").length, 1);
  });
});