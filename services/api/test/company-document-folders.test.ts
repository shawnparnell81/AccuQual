import { describe, expect, it } from "vitest";
import { COMPANY_DOCUMENT_FOLDERS, folderSeedPaths, inTemplateLibrary, locateSeedFolder, type FolderIdentity } from "../src/modules/document-folders/companyDocumentFolders.js";

function byPath(paths: string[][], names: string[]): boolean {
  return paths.some((path) => path.join("/") === names.join("/"));
}

describe("company document folders", () => {
  const paths = folderSeedPaths(COMPANY_DOCUMENT_FOLDERS);

  it("seeds Shawn's Engineering, Quality, and top-level drawers", () => {
    for (const product of ["CSA", "Fuel", "Shocks", "Air Suspension", "Gas/Electric Lifts"]) {
      expect(byPath(paths, ["Engineering", product, "Validation"])).toBe(true);
      expect(byPath(paths, ["Engineering", product, "Development"])).toBe(true);
    }
    for (const product of ["CSA", "Shocks", "Fuel", "Brake Wear sensors", "Gas/Electric Lifts", "Air Suspension"]) {
      expect(byPath(paths, ["Quality", "FAI", product])).toBe(true);
    }
    for (const name of ["Product Alerts", "Recalls", "Warranty", "Training", "Repair", "Inspections", "Audits"]) {
      expect(byPath(paths, ["Quality", name])).toBe(true);
    }
    for (const name of ["NCR", "CAPA", "8D", "Work Instruction", "Procedures", "SOP"]) {
      expect(byPath(paths, [name])).toBe(true);
    }
    expect(paths.some((path) => path.some((name) => /standard operating procedure body|work instruction body/i.test(name)))).toBe(false);
  });

  it("reuses a moved drawer and does not treat a blank-template folder as that drawer", () => {
    const folders: FolderIdentity[] = [
      { id: 1, name: "Engineering", parentId: null },
      { id: 2, name: "Quality", parentId: null },
      { id: 3, name: "Audits", parentId: 2 },
      { id: 4, name: "ISO Compliance Documents", parentId: null },
      { id: 5, name: "Blank Form Templates", parentId: 4 },
      { id: 6, name: "Training", parentId: 5 },
      { id: 7, name: "Validation", parentId: 5 },
      { id: 8, name: "NCR", parentId: 1 },
    ];
    expect(inTemplateLibrary(folders[5]!, folders)).toBe(true);
    expect(locateSeedFolder(folders, "Audits", 2)?.id).toBe(3);
    expect(locateSeedFolder(folders, "Training", 2)).toBeUndefined();
    expect(locateSeedFolder(folders, "NCR", null)?.id).toBe(8);
    expect(locateSeedFolder(folders, "Validation", 1)).toBeUndefined();
    expect(locateSeedFolder(folders, "CSA", 1)).toBeUndefined();
  });
});
