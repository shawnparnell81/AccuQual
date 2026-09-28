import { describe, expect, it } from "vitest";
import { buildMasterDocumentRows } from "../src/modules/documents/masterDocumentList.js";

describe("master document list", () => {
  it("builds a live row from the document, its published revision, and its folder", () => {
    const rows = buildMasterDocumentRows(
      [
        {
          id: 7,
          title: "Control of Documents",
          category: "sop-procedures",
          status: "approved",
          revisionCode: "Rev B",
          effectiveDate: new Date("2026-03-01T00:00:00Z"),
          isDeleted: false,
        },
        {
          id: 8,
          title: "Removed",
          category: null,
          status: "draft",
          revisionCode: null,
          effectiveDate: null,
          isDeleted: true,
        },
      ],
      [],
      [
        {
          subjectId: 7,
          versionNumber: 1,
          status: "archived",
          revisionCode: "Rev A",
          summary: "Initial release",
          publishedAt: new Date("2026-01-26T00:00:00Z"),
          reviewedAt: new Date("2026-01-26T00:00:00Z"),
          reviewedBy: 3,
        },
        {
          subjectId: 7,
          versionNumber: 2,
          status: "published",
          revisionCode: "Rev B",
          summary: "Added the folder column",
          publishedAt: new Date("2026-03-18T00:00:00Z"),
          reviewedAt: new Date("2026-03-18T00:00:00Z"),
          reviewedBy: 3,
        },
      ],
      new Map([[3, "Ron Wertz"]]),
      [
        { id: 1, name: "Quality", parentId: null, documentId: null },
        { id: 2, name: "Procedures", parentId: 1, documentId: 7 },
      ],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      documentId: "DOC-7",
      title: "Control of Documents",
      currentRev: "Rev B",
      approvalDate: "2026-03-18",
      approvedBy: "Ron Wertz",
      location: "Quality / Procedures",
      status: "Approved",
    });
    expect(rows[0]?.revHistory).toContain("Rev A");
    expect(rows[0]?.revHistory).toContain("Rev B");
    expect(rows[0]?.revHistory).toContain("Added the folder column");
  });
});
