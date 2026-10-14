import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isLiveTabPath, isTransientTabPath, selectRestoredTabs } from "./tabPaths";
import { blankOpenPath, isHiddenBlankLink, KEPT_FAI_START } from "./retiredBlanks";
import { templatesOnBlankShelf } from "./blankFormsList";
import { visibleExplorerFolders } from "./folderBrowse";

describe("blank start page is never a workspace tab (the bounce)", () => {
  for (const key of ["eco", "frm-ecr-001", "training-record", "frm-fai-001", "frm-ncr-001"]) {
    it(`/blank-forms/start/${key} is transient`, () => {
      assert.equal(isTransientTabPath(`/blank-forms/start/${key}`), true);
      assert.equal(isLiveTabPath(`/blank-forms/start/${key}`), false);
    });
  }
  it("keeps real pages live", () => {
    assert.equal(isLiveTabPath("/blank-forms"), true);
    assert.equal(isTransientTabPath("/blank-forms/eco"), false);
  });
  it("drops a saved start-page tab on restore so it cannot start another copy", () => {
    const restored = selectRestoredTabs([{ id: "a", path: "/blank-forms/start/eco" }, { id: "b", path: "/blank-forms" }], "a");
    assert.deepEqual(restored.tabs.map((t) => t.path), ["/blank-forms"]);
    assert.equal(restored.activeId, "b");
  });
});

describe("First Article Inspection Report: one blank", () => {
  it("opens FRM-FAI-001 directly; the retired duplicate goes to it too", () => {
    assert.equal(blankOpenPath("frm-fai-001"), KEPT_FAI_START);
    assert.equal(blankOpenPath("first_article_inspection"), KEPT_FAI_START);
    assert.equal(blankOpenPath("eco"), "/blank-forms/eco");
  });
  it("hides the duplicate from Blank Forms and Explorer", () => {
    const shelf = templatesOnBlankShelf([
      { formKey: "frm-fai-001", formId: "", title: "First Article Inspection Report", isoPath: ["Blank Forms Templates"] },
      { formKey: "first_article_inspection", formId: "", title: "First Article Inspection Report", isoPath: ["Blank Forms Templates"] },
    ]);
    assert.deepEqual(shelf.map((r) => r.formKey), ["frm-fai-001"]);
    assert.equal(isHiddenBlankLink("/qms-forms/first_article_inspection"), true);
    assert.equal(isHiddenBlankLink("/blank-forms/start/first_article_inspection"), true);
    assert.equal(isHiddenBlankLink(KEPT_FAI_START), false);
    const rows = visibleExplorerFolders([
      { id: 1, name: "Documents", parentId: null, sortOrder: 0 },
      { id: 3, name: "First Article Inspection Report", parentId: 1, sortOrder: 0, linkedPath: KEPT_FAI_START },
      { id: 4, name: "First Article Inspection Report", parentId: 1, sortOrder: 1, linkedPath: "/blank-forms/start/first_article_inspection" },
    ] as never);
    assert.deepEqual(rows.map((r: { id: number }) => r.id), [1, 3]);
  });
});
