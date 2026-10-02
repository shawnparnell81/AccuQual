import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canGoBack,
  canGoForward,
  explorerCrumbs,
  initialExplorerHistory,
  parentFolderId,
  pushExplorerPlace,
  stepExplorerHistory,
  virtualRange,
} from "./explorerNav.ts";

describe("explorer navigation", () => {
  it("walks back and forward through folders", () => {
    let history = initialExplorerHistory();
    history = pushExplorerPlace(history, { deptId: 1, folderId: null });
    history = pushExplorerPlace(history, { deptId: 1, folderId: 9 });
    assert.equal(canGoBack(history), true);
    assert.equal(canGoForward(history), false);
    history = stepExplorerHistory(history, -1);
    assert.equal(history.entries[history.index]?.folderId, null);
    assert.equal(canGoForward(history), true);
    history = pushExplorerPlace(history, { deptId: 2, folderId: 4 });
    assert.equal(history.entries.length, 3);
    assert.equal(canGoForward(history), false);
  });

  it("builds a parent crumb and ignores a repeat of the current place", () => {
    const crumbs = explorerCrumbs([
      { id: 1, name: "Document Control" },
      { id: 8, name: "Master Document Register" },
    ]);
    assert.deepEqual(crumbs.map((crumb) => crumb.name), ["Documents", "Document Control", "Master Document Register"]);
    assert.equal(parentFolderId([{ id: 1 }, { id: 8 }]), 1);
    const history = pushExplorerPlace(initialExplorerHistory(), { deptId: null, folderId: null });
    assert.equal(history.index, 0);
  });

  it("windows a long list and keeps a short one whole", () => {
    const windowed = virtualRange(200, 800, 400, 40);
    assert.ok(windowed.start > 0);
    assert.ok(windowed.end < 200);
    assert.ok(windowed.end - windowed.start < 40);
    assert.equal(virtualRange(3, 0, 400, 40).end, 3);
  });
});
