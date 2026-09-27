import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OFFICE_PREVIEW_BYTE_LIMIT, officePreviewRoute, officePreviewTooLarge, onlyOfficeFile, previewKind } from "./filePreview.ts";

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
    assert.equal(previewKind("legacy.xls"), "office");
    assert.equal(previewKind("export.csv"), "office");
  });

  it("uses the mime type when the name has no extension", () => {
    assert.equal(previewKind("evidence", "image/jpeg"), "image");
    assert.equal(previewKind("packet", "application/pdf"), "pdf");
    assert.equal(previewKind("grid", "text/csv"), "office");
    assert.equal(previewKind("book", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), "office");
  });

  it("leaves other types to download", () => {
    assert.equal(previewKind("notes.txt", "text/plain"), "download");
    assert.equal(previewKind("archive.zip"), "download");
    assert.equal(previewKind("legacy.doc"), "download");
  });
});

describe("office preview route", () => {
  it("keeps Word, Excel, and PowerPoint on ONLYOFFICE when that server is configured", () => {
    assert.equal(officePreviewRoute("procedure.docx", null, true), "onlyoffice");
    assert.equal(officePreviewRoute("log.xlsx", null, true), "onlyoffice");
    assert.equal(officePreviewRoute("deck.pptx", null, true), "onlyoffice");
    assert.equal(onlyOfficeFile("log.xlsx"), true);
  });

  it("previews in the browser when ONLYOFFICE is not configured", () => {
    assert.equal(officePreviewRoute("procedure.docx", null, false), "docx");
    assert.equal(officePreviewRoute("log.xlsx", null, false), "sheet");
    assert.equal(officePreviewRoute("deck.pptx", null, false), "pptx");
  });

  it("always uses the grid for legacy Excel and CSV", () => {
    assert.equal(officePreviewRoute("legacy.xls", null, true), "sheet");
    assert.equal(officePreviewRoute("export.csv", "text/csv", true), "sheet");
    assert.equal(onlyOfficeFile("legacy.xls"), false);
    assert.equal(onlyOfficeFile("export.csv"), false);
  });

  it("treats files over about 15 MB as too large to preview", () => {
    assert.equal(officePreviewTooLarge(OFFICE_PREVIEW_BYTE_LIMIT), false);
    assert.equal(officePreviewTooLarge(OFFICE_PREVIEW_BYTE_LIMIT + 1), true);
    assert.equal(officePreviewTooLarge(null), false);
  });
});
