import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DOCUMENT_FOLDER_PAGES, SIDEBAR_FOLDERS, flattenSidebarLinks, isFolder } from "../components/layout/sidebarStructure.ts";

describe("Quality document folders", () => {
  it("adds Product Alerts and Recalls as upload folders, in order with the other Quality items", () => {
    assert.equal(DOCUMENT_FOLDER_PAGES["product-alerts"]?.title, "Product Alerts");
    assert.equal(DOCUMENT_FOLDER_PAGES.recalls?.title, "Recalls");

    const quality = SIDEBAR_FOLDERS.find((folder) => folder.key === "quality");
    assert.ok(quality);
    const labels = quality.children.map((child) => child.label);
    const reports = labels.indexOf("Validation Reports");
    const alerts = labels.indexOf("Product Alerts");
    const recalls = labels.indexOf("Recalls");
    const warranty = labels.indexOf("Warranty");
    assert.ok(reports >= 0 && alerts === reports + 1 && recalls === alerts + 1 && warranty === recalls + 1);
    assert.equal(labels.includes("FAI"), false);

    const links = flattenSidebarLinks(quality.children);
    assert.deepEqual(
      links.filter((link) => link.key === "product-alerts" || link.key === "recalls").map((link) => [link.label, link.path]),
      [
        ["Product Alerts", "/folders/product-alerts"],
        ["Recalls", "/folders/recalls"],
      ],
    );
    assert.equal(labels.filter((label) => label === "Product Alerts" || label === "Recalls").length, 2);
    assert.equal(quality.children.filter((child) => !isFolder(child) && (child.key === "product-alerts" || child.key === "recalls")).length, 2);
  });

  it("adds Internal Audits under Audits as an upload folder, beside the other audit folders", () => {
    assert.equal(DOCUMENT_FOLDER_PAGES["internal-audits"]?.title, "Internal Audits");

    const quality = SIDEBAR_FOLDERS.find((folder) => folder.key === "quality");
    assert.ok(quality);
    const audits = quality.children.find((child) => isFolder(child) && child.key === "audits");
    assert.ok(audits && isFolder(audits));
    assert.deepEqual(
      audits.children.map((child) => child.label),
      ["Internal Audits", "Audit Plan", "Audit Schedule", "Audit Report"],
    );

    const links = flattenSidebarLinks([audits]);
    const internal = links.find((link) => link.key === "internal-audits");
    assert.deepEqual(internal && { label: internal.label, path: internal.path }, { label: "Internal Audits", path: "/folders/internal-audits" });
    assert.equal(links.filter((link) => link.label === "Internal Audits").length, 1);
  });

  it("adds Obsolete / Archive as a Quality folder, beside Document Control", () => {
    assert.equal(DOCUMENT_FOLDER_PAGES["obsolete-archive"]?.title, "Obsolete / Archive");

    const quality = SIDEBAR_FOLDERS.find((folder) => folder.key === "quality");
    assert.ok(quality);
    const labels = quality.children.map((child) => child.label);
    const control = labels.indexOf("Document Control");
    const archive = labels.indexOf("Obsolete / Archive");
    assert.equal(archive, control + 1);
    assert.equal(labels.filter((label) => label === "Obsolete / Archive").length, 1);

    const audits = quality.children.find((child) => isFolder(child) && child.key === "audits");
    assert.ok(audits && isFolder(audits));
    assert.equal(audits.children.some((child) => child.label === "Obsolete / Archive"), false);

    const link = flattenSidebarLinks(quality.children).find((item) => item.key === "obsolete-archive");
    assert.deepEqual(link && { label: link.label, path: link.path }, { label: "Obsolete / Archive", path: "/folders/obsolete-archive" });
  });

  it("lists Blank Forms under Workspace and keeps individual blanks out of the sidebar", () => {
    const workspace = SIDEBAR_FOLDERS.find((folder) => folder.key === "workspace");
    assert.ok(workspace);
    const blank = workspace.children.find((child) => child.key === "blank-forms");
    assert.ok(blank && !isFolder(blank));
    assert.deepEqual({ label: blank.label, path: blank.path }, { label: "Blank Forms", path: "/blank-forms" });

    const links = flattenSidebarLinks();
    assert.equal(links.filter((link) => link.path.startsWith("/iso-forms/")).length, 0);
    assert.equal(links.filter((link) => link.label === "Blank Forms").length, 1);
    const engineering = SIDEBAR_FOLDERS.find((folder) => folder.key === "engineering");
    assert.ok(engineering);
    assert.equal(engineering.children.some((child) => child.key.startsWith("frm-")), false);
  });

  it("keeps the shared menu free of form dumps and duplicate lists", () => {
    const links = flattenSidebarLinks();
    const labels = links.map((link) => link.label);
    assert.equal(labels.includes("QMS Forms"), false);
    assert.equal(labels.includes("Master Document List"), false);
    assert.equal(labels.includes("Master Tool List"), false);
    assert.equal(labels.includes("Audit Checklist"), false);
    assert.equal(labels.filter((label) => label === "Master Equipment List").length, 1);
    assert.equal(labels.includes("ADD SUPPLIER"), true);
    assert.equal(links.find((link) => link.key === "add-supplier")?.path, "/suppliers/new");

    const engineering = SIDEBAR_FOLDERS.find((folder) => folder.key === "engineering");
    assert.ok(engineering);
    const engineeringLabels = engineering.children.map((child) => child.label);
    for (const removed of ["FMEA", "ECN", "ECR", "Work Instructions", "Master Document List", "Master Equipment List", "Turtle Diagrams", "Cross-training evaluation"]) {
      assert.equal(engineeringLabels.includes(removed), false, removed);
    }
    assert.deepEqual(engineeringLabels, ["Drawings", "APQP", "PPAP Packet", "Risk dashboard", "Process Change"]);
  });
});
