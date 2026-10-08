import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bandHtmlForPage, printBandChoice, resolveDocumentFields, type DocumentBand } from "./documentBands.ts";

const header: DocumentBand = {
  differentFirstPage: false,
  differentOddEven: false,
  defaultHtml: "<p>ACME</p>",
  firstHtml: "",
  evenHtml: "",
};
const footer: DocumentBand = {
  differentFirstPage: false,
  differentOddEven: false,
  defaultHtml: "<p>Controlled</p>",
  firstHtml: "",
  evenHtml: "",
};
const blank: DocumentBand = {
  differentFirstPage: true,
  differentOddEven: false,
  defaultHtml: "<p> </p>",
  firstHtml: "",
  evenHtml: "",
};

describe("document print bands", () => {
  it("keeps the app header and footer unless that side has its own", () => {
    assert.deepEqual(printBandChoice(null, null), { header: "standard", footer: "standard" });
    assert.deepEqual(printBandChoice(undefined, footer), { header: "standard", footer: "custom" });
    assert.deepEqual(printBandChoice(header, null), { header: "custom", footer: "standard" });
    assert.deepEqual(printBandChoice(header, footer), { header: "custom", footer: "custom" });
    assert.deepEqual(printBandChoice(blank, footer), { header: "standard", footer: "custom" });
  });

  it("uses the first-page band on page 1 and the even band on even pages", () => {
    const varied: DocumentBand = {
      differentFirstPage: true,
      differentOddEven: true,
      defaultHtml: "<p>Odd</p>",
      firstHtml: "<p>First</p>",
      evenHtml: "<p>Even</p>",
    };
    assert.equal(bandHtmlForPage(varied, 1), "<p>First</p>");
    assert.equal(bandHtmlForPage(varied, 2), "<p>Even</p>");
    assert.equal(bandHtmlForPage(varied, 3), "<p>Odd</p>");
    assert.equal(bandHtmlForPage({ ...varied, differentFirstPage: false, differentOddEven: false }, 1), "<p>Odd</p>");
  });

  it("fills Doc ID, Rev, and the date when printing, and leaves page counters for the printer", () => {
    const html =
      '<p><span class="fb-doc-field" data-doc-field="page" contenteditable="false">Page number</span> ' +
      '<span class="fb-doc-field" data-doc-field="docId" contenteditable="false">Doc ID</span> ' +
      '<span class="fb-doc-field" data-doc-field="rev" contenteditable="false">Rev</span> ' +
      '<span class="fb-doc-field" data-doc-field="date" contenteditable="false">Date</span></p>';
    const resolved = resolveDocumentFields(html, { page: "counter", pages: 2, docId: "WI-14", rev: "C", date: "Oct 8, 2026" });
    assert.match(resolved, /fb-page-num/);
    assert.match(resolved, /WI-14 C Oct 8, 2026/);
    assert.doesNotMatch(resolved, /data-doc-field/);
  });
});
