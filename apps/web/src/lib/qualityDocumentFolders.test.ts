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
});
