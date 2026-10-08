import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyFolderPlacements, folderMoveIsBlocked, nextSortOrder, omitFolders, planNest, planSiblingGap, planSiblingReorder } from "./folderMove.ts";

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

  it("lets a saved file move into a folder even when the file is left out of the destination list", () => {
    const iso = { id: 1, parentId: null, sortOrder: 0 };
    const manual = { id: 2, parentId: 1, sortOrder: 0 };
    const pool = { id: 3, parentId: null, sortOrder: 1 };
    const file = { id: 4, parentId: 3, sortOrder: 0 };
    const nodes = [iso, manual, pool, file];
    const destinations = nodes.filter((node) => node.id !== file.id);
    assert.equal(folderMoveIsBlocked(destinations, file.id, manual.id), false);
    assert.deepEqual(planNest(nodes, file.id, manual.id), [{ id: 4, parentId: 2, sortOrder: 0 }]);
    assert.equal(folderMoveIsBlocked(nodes, manual.id, iso.id), false);
    assert.equal(planNest(nodes, iso.id, manual.id), null);
  });

  it("places a moved folder after its new siblings", () => {
    assert.equal(nextSortOrder(tree, null, 2), 2);
    assert.equal(nextSortOrder(tree, 4, 3), 0);
  });

  it("reorders siblings beside a row and leaves the parent alone", () => {
    const quality = { id: 3, parentId: 1, sortOrder: 1 };
    const engineering = { id: 2, parentId: 1, sortOrder: 0 };
    const placed = planSiblingReorder([engineering, quality], quality.id, engineering.id, "before", 1);
    assert.deepEqual(placed, [
      { id: 3, parentId: 1, sortOrder: 0 },
      { id: 2, parentId: 1, sortOrder: 1 },
    ]);
  });

  it("moves a nested folder up beside its parent without nesting into that row", () => {
    const engineering = { id: 2, parentId: 1, sortOrder: 0 };
    const quality = { id: 5, parentId: 1, sortOrder: 1 };
    const csa = { id: 3, parentId: 2, sortOrder: 0 };
    const placed = planSiblingReorder([engineering, quality], csa.id, quality.id, "before", 1);
    assert.deepEqual(placed, [
      { id: 3, parentId: 1, sortOrder: 1 },
      { id: 5, parentId: 1, sortOrder: 2 },
    ]);
  });

  it("places a drawer in the gap before a sibling without nesting into that row", () => {
    const iso = { id: 1, parentId: null, sortOrder: 0 };
    const quality = { id: 2, parentId: 1, sortOrder: 0 };
    const training = { id: 3, parentId: 1, sortOrder: 1 };
    const ncr = { id: 4, parentId: 1, sortOrder: 2 };
    const placed = planSiblingGap([iso, quality, training, ncr], ncr.id, 1, training.id, "before", () => true);
    assert.deepEqual(placed, [
      { id: 4, parentId: 1, sortOrder: 1 },
      { id: 3, parentId: 1, sortOrder: 2 },
    ]);
    assert.equal(placed?.some((row) => row.parentId === quality.id), false);
  });

  it("nests only when the drop asks to go inside, and refuses a cycle", () => {
    assert.deepEqual(planNest(tree, 3, 4), [{ id: 3, parentId: 4, sortOrder: 0 }]);
    assert.equal(planNest(tree, 1, 3), null);
    assert.deepEqual(planNest(tree, 3, 2), []);
  });

  it("shows a move in the list immediately, and drops a deleted pool row", () => {
    const moved = applyFolderPlacements(tree, [{ id: 3, parentId: 4, sortOrder: 0 }]);
    assert.equal(moved.find((row) => row.id === 3)?.parentId, 4);
    assert.equal(moved.find((row) => row.id === 2)?.parentId, 1);
    assert.deepEqual(
      omitFolders(tree, [2, 3]).map((row) => row.id),
      [1, 4],
    );
  });
});
