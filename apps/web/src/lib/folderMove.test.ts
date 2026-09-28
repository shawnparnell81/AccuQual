import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { folderMoveIsBlocked, nextSortOrder } from "./folderMove.ts";

const tree = [
  { id: 1, parentId: null, sortOrder: 0 },
  { id: 2, parentId: 1, sortOrder: 0 },
  { id: 3, parentId: 2, sortOrder: 0 },
  { id: 4, parentId: null, sortOrder: 1 },
];

describe("folder moves", () => {
  it("allows a subfolder to move to another parent or to the top level", () => {
    assert.equal(folderMoveIsBlocked(tree, 3, 4), false);
    assert.equal(folderMoveIsBlocked(tree, 2, null), false);
    assert.equal(folderMoveIsBlocked(tree, 3, 1), false);
  });

  it("blocks a folder from moving into itself or its own descendant", () => {
    assert.equal(folderMoveIsBlocked(tree, 2, 2), true);
    assert.equal(folderMoveIsBlocked(tree, 1, 3), true);
    assert.equal(folderMoveIsBlocked(tree, 2, 3), true);
  });

  it("places a moved folder after its new siblings", () => {
    assert.equal(nextSortOrder(tree, null, 2), 2);
    assert.equal(nextSortOrder(tree, 4, 3), 0);
  });
});
