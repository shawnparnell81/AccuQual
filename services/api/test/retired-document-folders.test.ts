import { describe, expect, it } from "vitest";
import { presentDocumentFolders, type FolderRef } from "../src/modules/document-folders/retiredDocumentFolders.js";

function tree(rows: { id: number; parentId: number | null; name: string }[]): FolderRef[] {
  return rows;
}

describe("document folders the library is allowed to show", () => {
  const folders = tree([
    { id: 1, parentId: null, name: "Customer Service" },
    { id: 2, parentId: 1, name: "Customer Accounts" },
    { id: 3, parentId: null, name: "Sales and Marketing" },
    { id: 4, parentId: 3, name: "Quotes & Proposals" },
    { id: 5, parentId: null, name: "Purchasing" },
    { id: 6, parentId: 5, name: "Purchase Orders" },
    { id: 7, parentId: null, name: "Material Management" },
    { id: 8, parentId: 7, name: "Raw Materials" },
    { id: 9, parentId: 8, name: "Raw Material Inventory" },
    { id: 10, parentId: 7, name: "Material Receiving" },
    { id: 11, parentId: null, name: "Shipping & Receiving" },
    { id: 12, parentId: 11, name: "Incoming Inspection" },
    { id: 13, parentId: 12, name: "Incoming Inspection Record" },
    { id: 14, parentId: 12, name: "Inspection Checklists" },
    { id: 15, parentId: 12, name: "Supplier Nonconformance Reports (Create NCR's Only)" },
    { id: 16, parentId: 11, name: "Outgoing Shipping" },
    { id: 17, parentId: null, name: "Production" },
    { id: 18, parentId: 17, name: "Production Planning" },
    { id: 19, parentId: 17, name: "Training & Competency" },
    { id: 20, parentId: 19, name: "Operator Training Records" },
    { id: 21, parentId: 17, name: "Safety & Compliance" },
    { id: 22, parentId: null, name: "Library Pool" },
  ]);

  const shown = presentDocumentFolders(folders);
  const names = shown.map((folder) => folder.name);

  it("hides Customer Service, Sales and Marketing, and Purchasing", () => {
    expect(names).not.toContain("Customer Service");
    expect(names).not.toContain("Sales and Marketing");
    expect(names).not.toContain("Purchasing");
    expect(names).not.toContain("Purchase Orders");
  });

  it("hides the Material Management branches the owner named, and keeps the rest", () => {
    expect(names).not.toContain("Raw Materials");
    expect(names).not.toContain("Raw Material Inventory");
    expect(names).toContain("Material Receiving");
  });

  it("keeps only the shipping folders that were asked for, and lifts them under Shipping & Receiving", () => {
    expect(names).toContain("Incoming Inspection Record");
    expect(names).toContain("Supplier Nonconformance Reports (Create NCR's Only)");
    expect(names).not.toContain("Incoming Inspection");
    expect(names).not.toContain("Inspection Checklists");
    expect(names).not.toContain("Outgoing Shipping");
    const record = shown.find((folder) => folder.name === "Incoming Inspection Record");
    expect(record?.parentId).toBe(11);
  });

  it("keeps Production training and safety, including what is already inside them", () => {
    expect(names).toContain("Training & Competency");
    expect(names).toContain("Operator Training Records");
    expect(names).toContain("Safety & Compliance");
    expect(names).not.toContain("Production Planning");
    expect(names).toContain("Library Pool");
  });

  it("treats departments under ISO Compliance Documents the same way it treats roots", () => {
    const nested = presentDocumentFolders([
      { id: 1, parentId: null, name: "ISO Compliance Documents" },
      { id: 2, parentId: 1, name: "Production" },
      { id: 3, parentId: 2, name: "Production Planning" },
      { id: 4, parentId: 1, name: "Training" },
      { id: 5, parentId: 4, name: "Operator Training Records" },
      { id: 6, parentId: 1, name: "Customer Service" },
      { id: 7, parentId: 6, name: "Customer Accounts" },
      { id: 8, parentId: null, name: "Library Pool" },
    ]);
    const nestedNames = nested.map((folder) => folder.name);
    expect(nestedNames).toContain("ISO Compliance Documents");
    expect(nestedNames).toContain("Production");
    expect(nestedNames).toContain("Training");
    expect(nestedNames).toContain("Operator Training Records");
    expect(nestedNames).not.toContain("Production Planning");
    expect(nestedNames).not.toContain("Customer Service");
    expect(nestedNames).not.toContain("Customer Accounts");
    expect(nestedNames).toContain("Library Pool");
  });
});
