import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SIDEBAR_FOLDERS, flattenSidebarLinks, isFolder, visibleSidebar } from "../components/layout/sidebarStructure.ts";

const QUALITY_LABELS = [
  "Obsolete / Archive",
  "Training",
  "Workers",
  "Inspections",
  "Product Alerts",
  "Recalls",
  "Warranty",
  "Repairs",
  "SOP",
  "Calibration",
  "Audits",
  "Suppliers",
  "NCR & CAPA",
  "Quarantined items",
];

describe("sidebar hierarchy", () => {
  it("puts Document Control above Quality and drops the Validation tab", () => {
    const labels = SIDEBAR_FOLDERS.map((folder) => folder.label);
    const control = labels.indexOf("Document Control");
    const quality = labels.indexOf("Quality");
    assert.ok(control >= 0 && quality === control + 1);
    assert.equal(labels.includes("Validation"), false);
    assert.equal(labels.includes("Validation Reports"), false);

    const links = flattenSidebarLinks();
    assert.equal(links.some((link) => link.path === "/folders/validation-reports" || link.label === "Validation Reports"), false);
    assert.equal(links.filter((link) => link.key === "document-control").length, 1);
    assert.equal(links.filter((link) => link.key === "quality").length, 0);
  });

  it("keeps Document Control's own pages and Quality's own folders", () => {
    const control = SIDEBAR_FOLDERS.find((folder) => folder.key === "document-control");
    const quality = SIDEBAR_FOLDERS.find((folder) => folder.key === "quality");
    assert.ok(control && isFolder(control));
    assert.ok(quality && isFolder(quality));
    assert.equal(control.path, "/documents");
    assert.deepEqual(
      control.children.map((child) => child.label),
      ["Folder Explorer", "Document changes", "Management System"],
    );
    assert.deepEqual(
      quality.children.map((child) => child.label),
      QUALITY_LABELS,
    );
    for (const label of QUALITY_LABELS) {
      assert.equal(control.children.some((child) => child.label === label), false, label);
    }
  });

  it("shows the same sections to a signed-in user and to an administrator", () => {
    for (const isAdmin of [false, true]) {
      const visible = visibleSidebar(SIDEBAR_FOLDERS, isAdmin, { auditLog: isAdmin });
      const labels = visible.map((folder) => ("label" in folder ? folder.label : ""));
      assert.equal(labels.indexOf("Quality"), labels.indexOf("Document Control") + 1);
      assert.equal(flattenSidebarLinks(visible).some((link) => link.label === "Validation Reports"), false);
      const quality = visible.find((folder) => isFolder(folder) && folder.key === "quality");
      assert.ok(quality && isFolder(quality));
      const ncr = quality.children.find((child) => isFolder(child) && child.key === "ncr-capa");
      assert.ok(ncr && isFolder(ncr));
      assert.equal(ncr.children.some((child) => child.label === "CAPA"), true);
      assert.equal(ncr.children.some((child) => child.label === "FRM NCR"), true);
    }
  });
});
