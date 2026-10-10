import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DOCUMENT_FOLDER_PAGES, ENGINEERING_PLANNER_URL, SIDEBAR_FOLDERS, flattenSidebarLinks, isFolder, pathMatches } from "../components/layout/sidebarStructure.ts";

describe("Quality document folders", () => {
  it("adds Product Alerts and Recalls as upload folders, in order with the other Quality items", () => {
    assert.equal(DOCUMENT_FOLDER_PAGES["product-alerts"]?.title, "Product Alerts");
    assert.equal(DOCUMENT_FOLDER_PAGES.recalls?.title, "Recalls");

    const quality = SIDEBAR_FOLDERS.find((folder) => folder.key === "quality");
    assert.ok(quality);
    const labels = quality.children.map((child) => child.label);
    const inspections = labels.indexOf("Inspections");
    const alerts = labels.indexOf("Product Alerts");
    const recalls = labels.indexOf("Recalls");
    const warranty = labels.indexOf("Warranty");
    assert.ok(inspections >= 0 && alerts === inspections + 1 && recalls === alerts + 1 && warranty === recalls + 1);
    assert.equal(labels.includes("FAI"), false);
    assert.equal(labels.includes("Validation Reports"), false);
    assert.equal(labels.includes("Document Control"), false);

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

  it("keeps Obsolete / Archive on the Documents menu", () => {
    assert.equal(DOCUMENT_FOLDER_PAGES["obsolete-archive"]?.title, "Obsolete / Archive");

    const documents = SIDEBAR_FOLDERS.find((folder) => folder.key === "document-control");
    assert.ok(documents && isFolder(documents));
    const labels = documents.children.map((child) => child.label);
    assert.equal(labels.filter((label) => label === "Obsolete / Archive").length, 1);

    const quality = SIDEBAR_FOLDERS.find((folder) => folder.key === "quality");
    assert.ok(quality && isFolder(quality));
    const audits = quality.children.find((child) => isFolder(child) && child.key === "audits");
    assert.ok(audits && isFolder(audits));
    assert.equal(audits.children.some((child) => child.label === "Obsolete / Archive"), false);

    const link = flattenSidebarLinks([documents]).find((item) => item.key === "obsolete-archive");
    assert.deepEqual(link && { label: link.label, path: link.path }, { label: "Obsolete / Archive", path: "/folders/obsolete-archive" });
  });

  it("puts Blank Forms on the sidebar and leaves FRM NCR plus the other Documents links", () => {
    const documents = SIDEBAR_FOLDERS.find((folder) => folder.key === "document-control");
    assert.ok(documents && isFolder(documents));
    assert.equal(documents.children.some((child) => child.key === "blank-forms"), true);
    assert.equal(documents.children.some((child) => child.label === "Folder Explorer"), true);
    assert.equal(documents.children.some((child) => child.label === "Document changes"), true);

    const links = flattenSidebarLinks();
    assert.deepEqual(
      links.filter((link) => link.path.startsWith("/iso-forms/")).map((link) => [link.label, link.path]),
      [["FRM NCR", "/iso-forms/frm-ncr-001"]],
    );
    assert.equal(links.filter((link) => link.label === "Blank Forms" && link.path === "/blank-forms").length, 1);
    assert.equal(SIDEBAR_FOLDERS.some((folder) => folder.key === "blank-forms"), false);
    assert.equal(SIDEBAR_FOLDERS.some((folder) => folder.key === "engineering"), true);
    assert.equal(documents.children.some((child) => child.key.startsWith("frm-")), false);
  });

  it("keeps the shared menu free of form dumps and duplicate lists", () => {
    const links = flattenSidebarLinks();
    const labels = links.map((link) => link.label);
    assert.equal(labels.includes("QMS Forms"), true);
    assert.equal(labels.filter((label) => label === "Master Document List").length, 1);
    assert.equal(labels.includes("Master Tool List"), false);
    assert.equal(labels.includes("Audit Checklist"), false);
    assert.equal(labels.filter((label) => label === "Master Equipment List").length, 1);
    assert.equal(labels.includes("ADD SUPPLIER"), true);
    assert.equal(links.find((link) => link.key === "add-supplier")?.path, "/suppliers/new");
    assert.equal(links.filter((link) => link.path === "/ncr" && link.label === "NCR").length, 1);
    const frmNcr = links.find((link) => link.key === "frm-ncr-001");
    assert.deepEqual(frmNcr && { label: frmNcr.label, path: frmNcr.path }, { label: "FRM NCR", path: "/iso-forms/frm-ncr-001" });
    const quality = SIDEBAR_FOLDERS.find((folder) => folder.key === "quality");
    const ncrCapa = quality?.children.find((child) => isFolder(child) && child.key === "ncr-capa");
    assert.ok(ncrCapa && isFolder(ncrCapa));
    assert.deepEqual(
      ncrCapa.children.map((child) => child.label),
      ["NCR", "FRM NCR", "CAPA", "8D"],
    );

    const documents = SIDEBAR_FOLDERS.find((folder) => folder.key === "document-control");
    const qualityDoor = SIDEBAR_FOLDERS.find((folder) => folder.key === "quality");
    assert.ok(documents && isFolder(documents));
    assert.ok(qualityDoor && isFolder(qualityDoor));
    const documentLabels = documents.children.map((child) => child.label);
    const qualityLabels = qualityDoor.children.map((child) => child.label);
    for (const removed of ["Turtle Diagrams", "Cross-training evaluation", "Master Tool List"]) {
      assert.equal(documentLabels.includes(removed), false, removed);
      assert.equal(qualityLabels.includes(removed), false, removed);
    }
    assert.equal(documentLabels.includes("Drawings"), true);
    assert.equal(documentLabels.includes("APQP"), true);
    assert.equal(documentLabels.includes("Controlled lists"), true);
    assert.equal(qualityLabels.includes("PPAP Packet"), true);
    assert.equal(qualityLabels.includes("Engineering Planner"), false);
    const engineering = SIDEBAR_FOLDERS.find((folder) => folder.key === "engineering");
    assert.ok(engineering && isFolder(engineering));
    const planner = engineering.children.find((child) => child.key === "engineering-planner");
    assert.ok(planner && !isFolder(planner));
    assert.equal(planner.external, true);
    assert.equal(planner.path, ENGINEERING_PLANNER_URL);
    assert.equal(pathMatches("/home", planner.path), false);
    assert.equal(pathMatches("/engineering", planner.path), false);
  });
});
