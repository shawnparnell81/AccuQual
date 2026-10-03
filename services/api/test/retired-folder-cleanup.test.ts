import { describe, expect, it } from "vitest";
import { isRetiredFolderPlacement, planRetiredFolderMoves, type FolderIdentity } from "../src/modules/document-folders/retiredFolderCleanup.js";

function row(id: number, name: string, parentId: number | null): FolderIdentity {
  return { id, name, parentId };
}

describe("retired folder placement", () => {
  it("refuses the named duplicates and keeps the Quality FAI product folders", () => {
    expect(isRetiredFolderPlacement("Components & Parts", ["ISO Compliance Documents", "Material Management"])).toBe(true);
    expect(isRetiredFolderPlacement("MRB Engineering Decisions", ["ISO Compliance Documents", "Engineering"])).toBe(true);
    expect(isRetiredFolderPlacement("Calibration Procedures", ["ISO Compliance Documents", "Quality", "Calibration & Equipment"])).toBe(true);
    expect(isRetiredFolderPlacement("Calibration Procedures", ["ISO Compliance Documents", "Engineering", "Calibration & Measurement"])).toBe(false);
    expect(isRetiredFolderPlacement("Customer Complaint", ["ISO Compliance Documents", "Quality"])).toBe(true);
    expect(isRetiredFolderPlacement("CSA", ["ISO Compliance Documents", "Engineering"])).toBe(true);
    expect(isRetiredFolderPlacement("Fuel", ["ISO Compliance Documents", "Engineering", "CSA"])).toBe(true);
    expect(isRetiredFolderPlacement("Validation", ["ISO Compliance Documents", "Engineering", "Shocks"])).toBe(true);
    expect(isRetiredFolderPlacement("CSA", ["ISO Compliance Documents", "Quality", "FAI / Validation"])).toBe(false);
    expect(isRetiredFolderPlacement("Fuel", ["ISO Compliance Documents", "Quality", "FAI / Validation"])).toBe(false);
  });

  it("moves engineering product trees onto Quality FAI and leaves that copy in place", () => {
    const folders: FolderIdentity[] = [
      row(1, "ISO Compliance Documents", null),
      row(2, "Engineering", 1),
      row(3, "CSA", 2),
      row(4, "Fuel", 3),
      row(5, "Validation", 3),
      row(6, "Quality", 1),
      row(7, "FAI / Validation", 6),
      row(8, "CSA", 7),
      row(9, "Fuel", 7),
      row(10, "Material Management", 1),
      row(11, "Components & Parts", 10),
      row(12, "Calibration & Equipment", 6),
      row(13, "Calibration Procedures", 12),
      row(14, "Procedures (SOPs)", 6),
      row(15, "Calibration Procedure", 14),
      row(16, "Customer Complaint Records", 6),
      row(17, "MRB Engineering Decisions", 2),
    ];
    const moves = planRetiredFolderMoves(folders);
    expect(moves).toEqual([
      { sourceId: 4, destId: 9 },
      { sourceId: 3, destId: 8 },
      { sourceId: 11, destId: 10 },
      { sourceId: 17, destId: 2 },
      { sourceId: 13, destId: 15 },
      { sourceId: 16, destId: 6 },
    ]);
  });
});
