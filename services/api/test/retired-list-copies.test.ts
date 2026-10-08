import { describe, expect, it } from "vitest";
import { planQualityManualCopyCleanup, type QualityManualNode } from "../src/modules/document-folders/retiredListCopies.js";

function node(partial: Partial<QualityManualNode> & Pick<QualityManualNode, "id" | "name" | "parentId">): QualityManualNode {
  return { pdfPath: null, linkedPath: null, documentId: null, ...partial };
}

const tree: QualityManualNode[] = [
  node({ id: 1, name: "ISO Compliance Documents", parentId: null }),
  node({ id: 10, name: "Quality Manual", parentId: 1 }),
  node({ id: 11, name: "Master Equipment List", parentId: 10, linkedPath: "/calibration/master-list" }),
  node({ id: 12, name: "LST-EQP-001 - Master Equipment List - Rev B", parentId: 10 }),
  node({ id: 13, name: "LST-GEN-001 - Master Document List - Rev B", parentId: 10, linkedPath: "/documents/master-list" }),
  node({ id: 14, name: "Scope of Laboratory Activities", parentId: 10, linkedPath: "/documents/laboratory-scope" }),
  node({ id: 15, name: "LST-GEN-003 Scope of Laboratory Activities.xlsx", parentId: 10, pdfPath: "forms/custom/lab.xlsx" }),
  node({ id: 16, name: "POL-001 Quality Policy", parentId: 10, pdfPath: "forms/custom/pol-001.pdf" }),
  node({ id: 17, name: "POL-002 Document Control", parentId: 10, pdfPath: "forms/custom/pol-002.pdf" }),
  node({ id: 18, name: "Master Equipment List", parentId: 10, linkedPath: "/calibration/master-list", pdfPath: "forms/custom/eqp.xlsx" }),
];

describe("Quality Manual retired list copies", () => {
  it("drops the empty equipment shell and the laboratory workbook, and archives a file stuck on the in-app row", () => {
    const plan = planQualityManualCopyCleanup(tree);
    expect(plan).toEqual([
      { id: 18, action: "delete-node", name: "Master Equipment List", parentId: 10, archivedPath: "forms/custom/eqp.xlsx" },
      { id: 12, action: "delete-node", name: "LST-EQP-001 - Master Equipment List - Rev B", parentId: 10, archivedPath: null },
      { id: 15, action: "delete-node", name: "LST-GEN-003 Scope of Laboratory Activities.xlsx", parentId: 10, archivedPath: "forms/custom/lab.xlsx" },
    ]);
    const removed = new Set(plan.filter((step) => step.action === "delete-node").map((step) => step.id));
    const kept = tree.filter((folder) => !removed.has(folder.id) && folder.parentId === 10);
    expect(kept.map((folder) => folder.name)).toEqual([
      "Master Equipment List",
      "LST-GEN-001 - Master Document List - Rev B",
      "Scope of Laboratory Activities",
      "POL-001 Quality Policy",
      "POL-002 Document Control",
    ]);
  });

  it("is idempotent and leaves the two POL files alone", () => {
    const removed = new Set(planQualityManualCopyCleanup(tree).filter((step) => step.action === "delete-node").map((step) => step.id));
    const cleared = tree.filter((folder) => !removed.has(folder.id));
    expect(planQualityManualCopyCleanup(cleared)).toEqual([]);
    expect(planQualityManualCopyCleanup(tree).some((step) => step.name.startsWith("POL-"))).toBe(false);
  });

  it("does not delete the only uploaded copy before the in-app list exists", () => {
    const onlyUpload = [
      node({ id: 1, name: "ISO Compliance Documents", parentId: null }),
      node({ id: 10, name: "Quality Manual", parentId: 1 }),
      node({ id: 15, name: "LST-GEN-003 Scope of Laboratory Activities.xlsx", parentId: 10, pdfPath: "forms/custom/lab.xlsx" }),
    ];
    expect(planQualityManualCopyCleanup(onlyUpload)).toEqual([]);
  });

  it("leaves an unlinked row named exactly like the in-app list for filing to attach", () => {
    const shell = [
      node({ id: 1, name: "ISO Compliance Documents", parentId: null }),
      node({ id: 10, name: "Quality Manual", parentId: 1 }),
      node({ id: 11, name: "Master Equipment List", parentId: 10 }),
      node({ id: 12, name: "LST-EQP-001 - Master Equipment List - Rev B", parentId: 10 }),
    ];
    const plan = planQualityManualCopyCleanup(shell);
    expect(plan.map((step) => step.id)).toEqual([12]);
  });

  it("does not turn a folder that still holds other items into a deletion", () => {
    const withChild = [
      node({ id: 1, name: "ISO Compliance Documents", parentId: null }),
      node({ id: 10, name: "Quality Manual", parentId: 1 }),
      node({ id: 11, name: "Master Equipment List", parentId: 10, linkedPath: "/calibration/master-list" }),
      node({ id: 19, name: "LST-EQP-001 - Master Equipment List - Rev B", parentId: 10 }),
      node({ id: 20, name: "Kept note", parentId: 19, pdfPath: "forms/note.pdf" }),
    ];
    expect(planQualityManualCopyCleanup(withChild).some((step) => step.id === 19)).toBe(false);
  });
});
