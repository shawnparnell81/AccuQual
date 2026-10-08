import assert from "node:assert/strict";
import test from "node:test";
import type { BrowseFolder } from "./folderBrowse";
import { folderNodeForRoute, folderNodePath, folderPathLookupEnabled, gridLocationInsert, joinFolderPath, locationAnswerInsert } from "./folderPath";

function folder(id: number, name: string, parentId: number | null, extra: Partial<BrowseFolder> = {}): BrowseFolder {
  return { id, name, parentId, sortOrder: 0, ...extra };
}

const tree = [
  folder(1, "ISO Compliance Documents", null),
  folder(2, "Quality Logs", 1),
  folder(3, "LST-NCR-001", 2, { linkedPath: "/documents/nonconformance-log" }),
  folder(4, "Test Data Projects", 1),
  folder(5, "LST-DEV-001", 4, { linkedPath: "/documents/development-log" }),
  folder(9, "Management System", 1),
  folder(10, "LST-GEN-002", 9, { linkedPath: "/documents/internal-audit-schedule" }),
  folder(11, "Engineering Logs", 1),
  folder(12, "LST-ENG-001", 11, { linkedPath: "/documents/engineering-request-log" }),
  folder(6, "Torque procedure", 2, { documentId: 14 }),
  folder(7, "Incoming check", 2, { linkedPath: "/form-builder/template/8" }),
  folder(8, "Incoming check copy", 4, { linkedPath: "/form-builder/fills/3" }),
];

test("folder paths use backslashes and the real folder names", () => {
  assert.equal(joinFolderPath(["ISO Compliance Documents", "Quality Logs", "LST-NCR-001"]), "ISO Compliance Documents\\Quality Logs\\LST-NCR-001");
  assert.equal(folderNodePath(tree, 3), "ISO Compliance Documents\\Quality Logs\\LST-NCR-001");
  assert.equal(folderNodePath(tree, 5), "ISO Compliance Documents\\Test Data Projects\\LST-DEV-001");
  assert.equal(folderNodePath(tree, 10), "ISO Compliance Documents\\Management System\\LST-GEN-002");
  assert.equal(folderNodePath(tree, 12), "ISO Compliance Documents\\Engineering Logs\\LST-ENG-001");
  assert.equal(folderNodePath(tree, 6), "ISO Compliance Documents\\Quality Logs\\Torque procedure");
});

test("a moved item's path follows its new parent", () => {
  const moved = tree.map((row) => (row.id === 3 ? { ...row, parentId: 4 } : row));
  assert.equal(folderNodePath(moved, 3), "ISO Compliance Documents\\Test Data Projects\\LST-NCR-001");
});

test("a renamed folder's path uses the new name", () => {
  const renamed = tree.map((row) => (row.id === 2 ? { ...row, name: "Plant Logs" } : row));
  assert.equal(folderNodePath(renamed, 2), "ISO Compliance Documents\\Plant Logs");
  assert.equal(folderNodePath(renamed, 3), "ISO Compliance Documents\\Plant Logs\\LST-NCR-001");
});

test("document pages resolve the folder the person can already open", () => {
  assert.equal(folderPathLookupEnabled("/documents/folders"), false);
  assert.equal(folderPathLookupEnabled("/dashboard"), false);
  assert.equal(folderPathLookupEnabled("/documents/nonconformance-log"), true);
  assert.equal(folderPathLookupEnabled("/documents/internal-audit-schedule"), true);
  assert.equal(folderNodeForRoute(tree, "/documents/internal-audit-schedule")?.id, 10);
  assert.equal(folderPathLookupEnabled("/documents/engineering-request-log"), true);
  assert.equal(folderNodeForRoute(tree, "/documents/engineering-request-log")?.id, 12);
  assert.equal(folderPathLookupEnabled("/form-builder/8"), true);
  assert.equal(folderPathLookupEnabled("/blank-forms/start/frm-ncr-001"), true);
  assert.equal(folderNodeForRoute(tree, "/documents/folders"), null);
  assert.equal(folderNodeForRoute(tree, "/documents/nonconformance-log")?.id, 3);
  assert.equal(folderNodeForRoute(tree, "/documents/14")?.id, 6);
  assert.equal(folderNodeForRoute(tree, "/form-builder/8")?.id, 7);
  assert.equal(folderNodeForRoute(tree, "/form-builder/fills/3")?.id, 8);
  assert.equal(folderNodeForRoute(tree, "/ncr"), null);
});

test("insert current path fills an empty Location answer and leaves a filled one", () => {
  assert.equal(locationAnswerInsert("", "ISO Compliance Documents\\Quality Logs\\LST-NCR-001"), "ISO Compliance Documents\\Quality Logs\\LST-NCR-001");
  assert.equal(locationAnswerInsert("Cage A", "ISO Compliance Documents\\Quality Logs\\LST-NCR-001"), null);
  assert.equal(gridLocationInsert("Location: X:\\old", "", "ISO Compliance Documents\\Quality Logs\\LST-NCR-001", false), "Location: ISO Compliance Documents\\Quality Logs\\LST-NCR-001");
  assert.equal(gridLocationInsert("Location: X:\\old", "already set", "ISO Compliance Documents\\Quality Logs\\LST-NCR-001", false), null);
  assert.equal(gridLocationInsert("", "", "ISO Compliance Documents\\Quality Logs\\LST-NCR-001", true), "ISO Compliance Documents\\Quality Logs\\LST-NCR-001");
  assert.equal(gridLocationInsert("Notes", "", "ISO Compliance Documents\\Quality Logs\\LST-NCR-001", false), null);
});
