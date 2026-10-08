import { describe, expect, it } from "vitest";
import { documentXmlToHtml, docxFromHtml, htmlFromDocx, htmlToDocumentXml } from "../../src/modules/form-builder/docx.js";

describe("form builder word documents", () => {
  it("keeps headings, emphasis, a list, a table, and a page break through a docx", async () => {
    const html = "<h1>Work instruction</h1><p>Hold the <b>gage</b> <i>square</i>.</p><ul><li>Check the bore</li></ul><table><tr><td>Spec</td><td>10</td></tr></table><div class=\"aq-page-break\"></div><p>Next page</p>";
    const xml = htmlToDocumentXml(html, { docId: "WI-1", rev: "A" });
    expect(xml).toContain("Doc ID: WI-1");
    expect(xml).toContain("Heading1");
    expect(xml).toContain("w:type=\"page\"");
    const back = documentXmlToHtml(xml);
    expect(back).toContain("Work instruction");
    expect(back).toContain("gage");
    expect(back).toContain("<table>");
    expect(back).toContain("aq-page-break");
    const file = await docxFromHtml(html, { docId: "WI-1", rev: "A" });
    const imported = htmlFromDocx(file);
    expect(imported).toContain("Work instruction");
    expect(imported).toContain("Check the bore");
    expect(imported).toContain("Next page");
  });
});
