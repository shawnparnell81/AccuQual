import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachmentParentId } from "./attachmentParent.ts";

describe("attachment parent id", () => {
  it("keeps a positive integer and skips composite list ids", () => {
    assert.equal(attachmentParentId(2), 2);
    assert.equal(attachmentParentId("12"), 12);
    assert.equal(attachmentParentId("2:0"), null);
    assert.equal(attachmentParentId("1:0"), null);
    assert.equal(attachmentParentId(0), null);
    assert.equal(attachmentParentId(-1), null);
    assert.equal(attachmentParentId(1.5), null);
    assert.equal(attachmentParentId(""), null);
    assert.equal(attachmentParentId(null), null);
  });
});
