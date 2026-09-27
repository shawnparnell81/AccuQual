import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { previewKind } from "./filePreview.ts";

describe("previewKind", () => {
  it("opens images, PDFs, and Office files in the app", () => {
    assert.equal(previewKind("photo.PNG", "image/png"), "image");
    assert.equal(previewKind("scan.jpg"), "image");
    assert.equal(previewKind("shot.jpeg"), "image");
    assert.equal(previewKind("diagram.gif"), "image");
    assert.equal(previewKind("logo.webp"), "image");
    assert.equal(previewKind("report.pdf", "application/pdf"), "pdf");
    assert.equal(previewKind("procedure.docx"), "office");
    assert.equal(previewKind("log.xlsx"), "office");
    assert.equal(previewKind("deck.pptx"), "office");
  });

  it("uses the mime type when the name has no extension", () => {
    assert.equal(previewKind("evidence", "image/jpeg"), "image");
    assert.equal(previewKind("packet", "application/pdf"), "pdf");
  });

  it("leaves other types to download", () => {
    assert.equal(previewKind("notes.txt", "text/plain"), "download");
    assert.equal(previewKind("archive.zip"), "download");
    assert.equal(previewKind("legacy.doc"), "download");
  });
});
