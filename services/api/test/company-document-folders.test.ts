import { describe, expect, it } from "vitest";
import { COMPANY_DOCUMENT_FOLDERS, FAI_VALIDATION_FOLDER_NAME, folderSeedPaths, inTemplateLibrary, locateSeedFolder, planFaiValidationRepair, planQualityTrainingRepair, type FolderIdentity } from "../src/modules/document-folders/companyDocumentFolders.js";
import { DEFAULT_DOCUMENT_FOLDERS } from "../src/modules/document-folders/defaultDocumentFolders.js";

function byPath(paths: string[][], names: string[]): boolean {
  return paths.some((path) => path.join("/") === names.join("/"));
}

describe("company document folders", () => {
  const paths = folderSeedPaths(COMPANY_DOCUMENT_FOLDERS);

  it("seeds Shawn's departments under ISO Compliance Documents", () => {
    expect(byPath(paths, ["ISO Compliance Documents"])).toBe(true);
    for (const product of ["CSA", "Fuel", "Shocks", "Air Suspension", "Gas/Electric Lifts"]) {
      expect(byPath(paths, ["ISO Compliance Documents", "Engineering", product, "Validation"])).toBe(false);
      expect(byPath(paths, ["ISO Compliance Documents", "Engineering", product, "Development"])).toBe(false);
    }
    for (const product of ["CSA", "Shocks", "Fuel", "Brake Wear sensors", "Gas/Electric Lifts", "Air Suspension"]) {
      expect(byPath(paths, ["ISO Compliance Documents", "Quality", FAI_VALIDATION_FOLDER_NAME, product])).toBe(true);
    }
    expect(paths.filter((path) => path.join("/") === `ISO Compliance Documents/Quality/${FAI_VALIDATION_FOLDER_NAME}/CSA`)).toHaveLength(1);
    expect(byPath(paths, ["ISO Compliance Documents", "Quality", "FAI"])).toBe(false);
    const faiParent = COMPANY_DOCUMENT_FOLDERS[0]?.children.find((folder) => folder.name === "Quality")?.children.find((folder) => folder.name === FAI_VALIDATION_FOLDER_NAME);
    expect(faiParent?.children.map((folder) => folder.name)).toEqual(["CSA", "Shocks", "Fuel", "Brake Wear sensors", "Gas/Electric Lifts", "Air Suspension"]);
    expect(COMPANY_DOCUMENT_FOLDERS[0]?.children.find((folder) => folder.name === "Quality")?.children.some((folder) => folder.name === "Document Control")).toBe(false);
    for (const name of ["Product Alerts", "Recalls", "Warranty", "Repair", "Inspections"]) {
      expect(byPath(paths, ["ISO Compliance Documents", "Quality", name])).toBe(true);
    }
    expect(byPath(paths, ["ISO Compliance Documents", "Quality", "Training"])).toBe(false);
    for (const name of ["CAPA", "NCR", "8D", "Audits"]) {
      expect(byPath(paths, ["ISO Compliance Documents", "Quality", name])).toBe(false);
    }
    for (const name of ["Audits", "Training", "Safety", "Production", "NCR", "CAPA", "8D", "Work Instruction", "Procedures", "SOP"]) {
      expect(byPath(paths, ["ISO Compliance Documents", name])).toBe(true);
    }
    expect(byPath(paths, ["ISO Compliance Documents", "SOP", "Policies"])).toBe(true);
    expect(byPath(paths, ["ISO Compliance Documents", "SOP", "Procedures"])).toBe(false);
    expect(byPath(paths, ["ISO Compliance Documents", "Audits", "Safety Audits"])).toBe(true);
    expect(byPath(paths, ["ISO Compliance Documents", "Training", "Operator Training Records"])).toBe(true);
    expect(paths.some((path) => path.some((name) => name === "PCB" || name === "PCB Layouts"))).toBe(false);
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
    const moved = [
      { id: 1, name: "ISO Compliance Documents", parentId: null },
      { id: 2, name: "Master Source Files", parentId: 1 },
      { id: 3, name: "Quality", parentId: 2 },
    ];
    expect(inTemplateLibrary(moved[2]!, moved)).toBe(false);
    expect(locateSeedFolder(moved, "Quality", 1)?.id).toBe(3);
    expect(locateSeedFolder(folders, "CSA", 1)).toBeUndefined();
  });

  it("folds Quality/Training into the ISO Training drawer and leaves blank-template Training alone", () => {
    const folders: FolderIdentity[] = [
      { id: 1, name: "ISO Compliance Documents", parentId: null },
      { id: 2, name: "Quality", parentId: 1 },
      { id: 3, name: "Training", parentId: 2 },
      { id: 4, name: "Training", parentId: 1 },
      { id: 5, name: "Operator Training Records", parentId: 4 },
      { id: 6, name: "Blank Form Templates", parentId: 1 },
      { id: 7, name: "Training", parentId: 6 },
      { id: 8, name: "NCR", parentId: 1 },
    ];
    expect(planQualityTrainingRepair(folders)).toEqual([{ sourceId: 3, destId: 4, isoId: 1 }]);
    expect(byPath(paths, ["ISO Compliance Documents", "Training", "Operator Training Records"])).toBe(true);
  });

  it("reparents the only Quality/Training folder onto ISO when no other Training drawer exists", () => {
    const folders: FolderIdentity[] = [
      { id: 1, name: "ISO Compliance Documents", parentId: null },
      { id: 2, name: "Quality", parentId: 1 },
      { id: 3, name: "Training", parentId: 2 },
      { id: 9, name: "Safety Notes", parentId: 3 },
    ];
    expect(planQualityTrainingRepair(folders)).toEqual([{ sourceId: 3, destId: null, isoId: 1 }]);
  });

  it("renames the Quality FAI drawer in place and leaves Engineering Validation folders alone", () => {
    const folders: FolderIdentity[] = [
      { id: 1, name: "ISO Compliance Documents", parentId: null },
      { id: 2, name: "Quality", parentId: 1 },
      { id: 3, name: "FAI", parentId: 2 },
      { id: 4, name: "CSA", parentId: 3 },
      { id: 5, name: "Shocks", parentId: 3 },
      { id: 10, name: "Engineering", parentId: 1 },
      { id: 11, name: "CSA", parentId: 10 },
      { id: 12, name: "Validation", parentId: 11 },
      { id: 13, name: "First Article Inspection (FAI)", parentId: 2 },
      { id: 14, name: "Blank Form Templates", parentId: 1 },
      { id: 15, name: "FAI", parentId: 14 },
    ];
    expect(planFaiValidationRepair(folders)).toEqual([{ sourceId: 3, destId: null }]);
    expect(byPath(paths, ["ISO Compliance Documents", "Engineering", "CSA", "Validation"])).toBe(false);
  });

  it("folds a leftover FAI drawer into the renamed folder instead of keeping both", () => {
    const folders: FolderIdentity[] = [
      { id: 1, name: "ISO Compliance Documents", parentId: null },
      { id: 2, name: "Quality", parentId: 1 },
      { id: 3, name: "FAI", parentId: 2 },
      { id: 4, name: "CSA", parentId: 3 },
      { id: 8, name: FAI_VALIDATION_FOLDER_NAME, parentId: 2 },
    ];
    expect(planFaiValidationRepair(folders)).toEqual([{ sourceId: 3, destId: 8 }]);
  });

  it("does nothing when the drawer is already named FAI / Validation", () => {
    const folders: FolderIdentity[] = [
      { id: 1, name: "ISO Compliance Documents", parentId: null },
      { id: 2, name: "Quality", parentId: 1 },
      { id: 3, name: FAI_VALIDATION_FOLDER_NAME, parentId: 2 },
      { id: 4, name: "CSA", parentId: 3 },
    ];
    expect(planFaiValidationRepair(folders)).toEqual([]);
  });

  it("does nothing when Training is already only under ISO", () => {
    const folders: FolderIdentity[] = [
      { id: 1, name: "ISO Compliance Documents", parentId: null },
      { id: 2, name: "Quality", parentId: 1 },
      { id: 4, name: "Training", parentId: 1 },
    ];
    expect(planQualityTrainingRepair(folders)).toEqual([]);
  });
});

describe("default document folder seed", () => {
  const paths = folderSeedPaths(DEFAULT_DOCUMENT_FOLDERS);

  it("puts every department under ISO and leaves Production empty", () => {
    expect(DEFAULT_DOCUMENT_FOLDERS.map((folder) => folder.name)).toEqual(["ISO Compliance Documents"]);
    for (const name of ["Engineering", "Quality", "Audits", "Training", "Safety", "Production", "CAPA", "NCR", "8D", "SOP"]) {
      expect(byPath(paths, ["ISO Compliance Documents", name])).toBe(true);
    }
    expect(byPath(paths, ["ISO Compliance Documents", "SOP", "Policies"])).toBe(true);
    expect(byPath(paths, ["ISO Compliance Documents", "SOP", "Procedures"])).toBe(false);
    expect(byPath(paths, ["ISO Compliance Documents", "Quality", "Audits"])).toBe(false);
    expect(byPath(paths, ["ISO Compliance Documents", "Quality", "CAPA"])).toBe(false);
    expect(byPath(paths, ["ISO Compliance Documents", "Quality", "NCR"])).toBe(false);
    expect(byPath(paths, ["ISO Compliance Documents", "Quality", "8D"])).toBe(false);
    expect(byPath(paths, ["ISO Compliance Documents", "Quality", "Training"])).toBe(false);
    expect(byPath(paths, ["ISO Compliance Documents", "Production", "Training & Competency"])).toBe(false);
    expect(byPath(paths, ["ISO Compliance Documents", "Production", "Safety & Compliance"])).toBe(false);
    expect(paths.filter((path) => path[path.length - 1] === "Production" && path.includes("ISO Compliance Documents"))).toHaveLength(1);
    const production = paths.find((path) => path.at(-1) === "Production");
    expect(paths.some((path) => production && path.length > production.length && path.slice(0, production.length).join("/") === production.join("/"))).toBe(false);
    expect(paths.some((path) => path.some((name) => name === "PCB" || name === "PCB Layouts"))).toBe(false);
    expect(byPath(paths, ["ISO Compliance Documents", "Audits", "Safety Audits"])).toBe(true);
    expect(byPath(paths, ["ISO Compliance Documents", "Training", "Operator Training Records"])).toBe(true);
    expect(byPath(paths, ["ISO Compliance Documents", "Safety", "Safety Procedures"])).toBe(true);
    expect(paths.some((path) => path.includes("Safety") && path.includes("Safety Audits"))).toBe(false);
  });
});
