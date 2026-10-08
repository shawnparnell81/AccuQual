import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { folderContents, savedItemRemoval, sortFolderDetails, type FolderDetailNode } from "./folderDetails.ts";

function node(partial: Partial<FolderDetailNode> & Pick<FolderDetailNode, "id" | "name" | "parentId">): FolderDetailNode {
  return { sortOrder: partial.id, linkedPath: null, pdfPath: null, documentId: null, ...partial };
}

describe("folder details", () => {
  it("lists Quality Logs with subfolders first and LST-NCR-001 as one controlled-list row", () => {
    const rows = [
      node({ id: 1, name: "Quality Logs", parentId: null }),
      node({ id: 2, name: "Open Holds", parentId: 1, sortOrder: 5 }),
      node({ id: 3, name: "Closed Holds", parentId: 1, sortOrder: 1 }),
      node({ id: 4, name: "LST-NCR-001", parentId: 1, linkedPath: "/documents/nonconformance-log", listRevision: "G", listUpdatedAt: "2026-07-14T12:00:00.000Z", modifiedByName: "Shawn Parnell" }),
      node({ id: 5, name: "FRM-NCR-001_4_2026-10-01", parentId: 1, linkedPath: "/iso-forms/record/4", updatedAt: "2026-10-01T15:00:00.000Z" }),
    ];
    const items = folderContents(rows, 1);
    assert.deepEqual(
      items.map((item) => [item.type, item.label, item.revision]),
      [
        ["folder", "Closed Holds", null],
        ["folder", "Open Holds", null],
        ["form", "FRM-NCR-001_4_2026-10-01", null],
        ["controlled list", "LST-NCR-001 - Non-Conformance Log (Register)", "G"],
      ],
    );
    const list = items.find((item) => item.type === "controlled list");
    assert.equal(list?.href, "/documents/nonconformance-log");
    assert.equal(list?.modifiedAt, "2026-07-14T12:00:00.000Z");
    assert.equal(list?.modifiedBy, "Shawn Parnell");
  });

  it("lists Engineering Logs subfolders before LST-ENG-001", () => {
    const rows = [
      node({ id: 1, name: "Engineering Logs", parentId: null }),
      node({ id: 2, name: "Open_Issues", parentId: 1 }),
      node({ id: 3, name: "Closed_Records", parentId: 1 }),
      node({ id: 4, name: "LST-ENG-001", parentId: 1, linkedPath: "/documents/engineering-request-log", listRevision: "A" }),
    ];
    const items = folderContents(rows, 1);
    assert.deepEqual(
      items.map((item) => item.label),
      ["Closed_Records", "Open_Issues", "LST-ENG-001 - Engineering Request Change Log"],
    );
    assert.equal(items[2]?.type, "controlled list");
    assert.equal(items[2]?.revision, "A");
    assert.equal(items[2]?.href, "/documents/engineering-request-log");
  });

  it("shows each Quality Manual list once, with Rev from the list record, plus the two POL files", () => {
    const manual = node({ id: 10, name: "Quality Manual", parentId: 1 });
    const rows = [
      node({ id: 1, name: "ISO Compliance Documents", parentId: null }),
      manual,
      node({ id: 11, name: "Master Equipment List", parentId: 10, linkedPath: "/calibration/master-list", listRevision: "A" }),
      node({ id: 12, name: "LST-EQP-001 - Master Equipment List - Rev B", parentId: 10, pdfPath: "forms/custom/eqp.xlsx" }),
      node({ id: 13, name: "LST-EQP-001 - Master Equipment List - Rev B", parentId: 10 }),
      node({ id: 14, name: "LST-GEN-001 - Master Document List - Rev B", parentId: 10, linkedPath: "/documents/master-list", listRevision: "B" }),
      node({ id: 15, name: "Scope of Laboratory Activities", parentId: 10, linkedPath: "/documents/laboratory-scope", listRevision: "A" }),
      node({ id: 16, name: "LST-GEN-003 Scope of Laboratory Activities.xlsx", parentId: 10, pdfPath: "forms/custom/lab.xlsx" }),
      node({ id: 17, name: "POL-001 Quality Policy", parentId: 10, pdfPath: "forms/custom/pol-001.pdf", updatedAt: "2026-03-01T00:00:00.000Z" }),
      node({ id: 18, name: "POL-002 Document Control", parentId: 10, pdfPath: "forms/custom/pol-002.pdf" }),
    ];
    const items = folderContents(rows, 10);
    assert.deepEqual(
      items.map((item) => [item.type, item.label, item.revision, item.href]),
      [
        ["controlled list", "LST-EQP-001 - Master Equipment List", "A", "/calibration/master-list"],
        ["controlled list", "LST-GEN-001 - Master Document List", "B", "/documents/master-list"],
        ["controlled list", "LST-GEN-003 - Scope of Laboratory Activities", "A", "/documents/laboratory-scope"],
        ["file", "POL-001 Quality Policy", null, null],
        ["file", "POL-002 Document Control", null, null],
      ],
    );
    assert.equal(items.filter((item) => item.label.startsWith("LST-EQP-001")).length, 1);
    assert.equal(items.some((item) => item.type === "folder"), false);
  });

  it("keeps a real subfolder that happens to share a list title when it has items inside", () => {
    const rows = [
      node({ id: 1, name: "Quality Manual", parentId: null }),
      node({ id: 2, name: "Master Document List", parentId: 1 }),
      node({ id: 3, name: "Notes.pdf", parentId: 2, pdfPath: "forms/notes.pdf" }),
      node({ id: 4, name: "LST-GEN-001 - Master Document List - Rev B", parentId: 1, linkedPath: "/documents/master-list", listRevision: "B" }),
    ];
    const items = folderContents(rows, 1);
    assert.deepEqual(
      items.map((item) => [item.type, item.label]),
      [
        ["folder", "Master Document List"],
        ["controlled list", "LST-GEN-001 - Master Document List"],
      ],
    );
  });

  it("sorts within folders and items when a column header is clicked", () => {
    const rows = [
      node({ id: 1, name: "Engineering Logs", parentId: null }),
      node({ id: 2, name: "Open_Issues", parentId: 1 }),
      node({ id: 3, name: "Closed_Records", parentId: 1 }),
      node({ id: 4, name: "LST-ENG-001", parentId: 1, linkedPath: "/documents/engineering-request-log" }),
      node({ id: 5, name: "Blank", parentId: 1, linkedPath: "/blank-forms/start/frm-ncr-001" }),
    ];
    const items = folderContents(rows, 1, { key: "type", direction: "asc" });
    assert.deepEqual(items.map((item) => item.type), ["folder", "folder", "controlled list", "template"]);
    assert.equal(items[0]?.label, "Closed_Records");
    const byNameDesc = sortFolderDetails(items, { key: "name", direction: "desc" });
    assert.deepEqual(byNameDesc.map((item) => item.label), [
      "Open_Issues",
      "Closed_Records",
      "LST-ENG-001 - Engineering Request Change Log",
      "Blank",
    ]);
  });

  it("states whether Remove unlinks a file or takes the item out of the folder", () => {
    const upload = savedItemRemoval({ name: "LST-EQP-001 - Master Equipment List - Rev B", linkedPath: null, documentId: null, pdfPath: "forms/eqp.xlsx" }, false);
    assert.equal(upload.mode, "remove-item");
    assert.match(upload.body, /archived and kept/);
    assert.match(upload.body, /taken out of the folder/);
    assert.match(upload.body, /does not leave an empty folder/);
    const linked = savedItemRemoval({ name: "Master Equipment List", linkedPath: "/calibration/master-list", documentId: null, pdfPath: "forms/eqp.xlsx" }, false);
    assert.equal(linked.mode, "unlink-file");
    assert.match(linked.body, /Unlink the uploaded file/);
    assert.match(linked.body, /stays in this folder/);
    assert.match(linked.body, /does not create a folder/);
  });

  it("renders folder contents through the shared details list", () => {
    const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../routes/Documents/FolderExplorerPage.tsx"), "utf8");
    assert.match(page, /FolderContentsList/);
    assert.match(page, /savedItemRemoval/);
    assert.match(page, /folderContents\(/);
    assert.doesNotMatch(page, /rounded-full border border-primary\/40 bg-primary\/10 px-3 py-1/);
    assert.doesNotMatch(page, /collapsed\[sub\.id\] !== false/);
  });
});
