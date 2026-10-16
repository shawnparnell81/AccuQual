import { describe, expect, it } from "vitest";
import { folderPathForRoute } from "../../src/modules/document-folders/itemPath.js";

const folders = [
  { id: 1, name: "ISO Compliance Documents", parentId: null },
  { id: 2, name: "Quality", parentId: 1 },
  { id: 3, name: "NCR-0001", parentId: 2, linkedPath: "/ncr/7?tab=form" },
  { id: 4, name: "Loose copy", parentId: null, linkedPath: "/ncr/7" },
  { id: 5, name: "Built form", parentId: 2, linkedPath: "/form-builder/template/9" },
  { id: 6, name: "Manual", parentId: 2, documentId: 12 },
];

describe("folderPathForRoute", () => {
  it("prefers a filed row over a top-level one and joins the path like the web app", () => {
    expect(folderPathForRoute(folders, "/ncr/7")).toEqual({ folderId: 3, path: "ISO Compliance Documents\\Quality\\NCR-0001" });
  });
  it("finds a built form from its editor and a document from its own row", () => {
    expect(folderPathForRoute(folders, "/form-builder/9").folderId).toBe(5);
    expect(folderPathForRoute(folders, "/documents/12").folderId).toBe(6);
  });
  it("answers an empty path for a page that is not filed", () => {
    expect(folderPathForRoute(folders, "/ncr/8")).toEqual({ folderId: null, path: "" });
  });
});
