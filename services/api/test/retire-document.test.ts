import { describe, expect, it } from "vitest";
import { folderBeforeArchive, isInObsoleteArchive, OBSOLETE_ARCHIVE_CATEGORY, retiredDocumentWrite } from "../src/modules/documents/obsoleteArchive.js";

describe("retire locks one document", () => {
  it("files the retired document in Obsolete / Archive and leaves every other field alone", () => {
    const write = retiredDocumentWrite({ category: "procedures", status: "approved" });
    expect(write).toEqual({
      category: OBSOLETE_ARCHIVE_CATEGORY,
      status: "obsolete",
      changes: {
        action: "obsolete",
        fromCategory: "procedures",
        toCategory: OBSOLETE_ARCHIVE_CATEGORY,
        fromStatus: "approved",
        status: "obsolete",
      },
    });
    expect(isInObsoleteArchive({ status: write.status, category: write.category })).toBe(true);
    expect(isInObsoleteArchive({ status: "obsolete", category: "procedures" })).toBe(false);
    expect(isInObsoleteArchive({ status: "approved", category: "procedures" })).toBe(false);
  });

  it("restores the folder from the newest retire or archive move", () => {
    const history = [
      { changes: { action: "moved_to_obsolete", fromCategory: "old", fromStatus: "draft" } },
      { changes: { action: "obsolete", fromCategory: "work-instructions", fromStatus: "approved" } },
    ];
    expect(folderBeforeArchive(history)).toEqual({ fromCategory: "work-instructions", fromStatus: "approved" });
    expect(folderBeforeArchive([{ changes: { action: "moved_to_obsolete", fromCategory: "sops", fromStatus: "in_review" } }])).toEqual({
      fromCategory: "sops",
      fromStatus: "in_review",
    });
  });
});
