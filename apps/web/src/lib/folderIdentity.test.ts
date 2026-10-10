import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { folderIdentityKey, folderNameTaken } from "./folderIdentity";

describe("folder identity", () => {
  it("treats spacing, case, underscores, and a leading number as the same name", () => {
    const key = folderIdentityKey("Quality Manual");
    assert.equal(folderIdentityKey("  quality   manual "), key);
    assert.equal(folderIdentityKey("Quality_Manual"), key);
    assert.equal(folderIdentityKey("01 Quality Manual"), key);
    assert.equal(folderIdentityKey("01_Quality_Manual"), key);
    assert.equal(folderIdentityKey("01. Quality Manual"), key);
    assert.equal(folderIdentityKey("8D"), "8d");
    assert.notEqual(folderIdentityKey("8D"), key);
  });

  it("matches any sibling at the same level, including a saved file", () => {
    const siblings = ["Procedures", "LST_NCR_001"];
    assert.equal(folderNameTaken("procedures", siblings), true);
    assert.equal(folderNameTaken("01_Procedures", siblings), true);
    assert.equal(folderNameTaken("lst ncr 001", siblings), true);
    assert.equal(folderNameTaken("Work Instructions", siblings), false);
    assert.equal(folderNameTaken("   ", siblings), false);
  });
});
