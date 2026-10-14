import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formStatusLabel, newRevisionProblem } from "./formRevision.ts";

describe("form status badge", () => {
  it("says Draft, Pending approval, or Live REV X", () => {
    assert.equal(formStatusLabel({ status: "draft", revision: "A", pendingRevision: null }), "Draft");
    assert.equal(formStatusLabel({ status: "draft", revision: "A", pendingRevision: "A" }), "Pending approval · REV A");
    assert.equal(formStatusLabel({ status: "published", revision: "B", pendingRevision: null }), "Live REV B");
  });

  it("keeps showing the live REV while a newer one waits", () => {
    assert.equal(formStatusLabel({ status: "published", revision: "B", pendingRevision: "C" }), "Live REV B · REV C pending approval");
  });
});

describe("new revision entry", () => {
  it("never accepts the current REV, whatever the case", () => {
    assert.ok(newRevisionProblem("B", "b"));
    assert.equal(newRevisionProblem("B", "C"), null);
  });
});
