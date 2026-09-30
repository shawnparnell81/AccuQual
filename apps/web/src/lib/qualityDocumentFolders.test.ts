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
    const fai = labels.indexOf("FAI");
    const alerts = labels.indexOf("Product Alerts");
    const recalls = labels.indexOf("Recalls");
    const warranty = labels.indexOf("Warranty");
    assert.ok(fai >= 0 && alerts === fai + 1 && recalls === alerts + 1 && warranty === recalls + 1);

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
      ["Internal Audits", "Audit Plan", "Audit Schedule", "Audit Checklist", "Internal Audit Checklist", "Internal Audit Summary Report", "Audit Report"],
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
});
