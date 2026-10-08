import { describe, expect, it } from "vitest";
import { documentXmlToHtml, docxFromHtml, htmlFromDocx, htmlToDocumentXml, officePackage } from "../../src/modules/form-builder/docx.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function wordWithHeader(): Buffer {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:r><w:t>Work instruction body</w:t></w:r></w:p>
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rId2"/>
      <w:headerReference w:type="first" r:id="rId3"/>
      <w:headerReference w:type="even" r:id="rId4"/>
      <w:footerReference w:type="default" r:id="rId5"/>
      <w:footerReference w:type="first" r:id="rId6"/>
      <w:titlePg/>
      <w:evenAndOddHeaders/>
    </w:sectPr>
  </w:body>
</w:document>`;
  const header = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:p>
    <w:pPr><w:jc w:val="center"/></w:pPr>
    <w:r><w:rPr><w:b/></w:rPr><w:t>ACME Quality</w:t></w:r>
  </w:p>
  <w:p>
    <w:r><w:t xml:space="preserve">Page </w:t></w:r>
    <w:r><w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
    <w:r><w:fldChar w:fldCharType="separate"/></w:r>
    <w:r><w:t>1</w:t></w:r>
    <w:r><w:fldChar w:fldCharType="end"/></w:r>
    <w:r><w:t xml:space="preserve"> of </w:t></w:r>
    <w:r><w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r>
    <w:r><w:fldChar w:fldCharType="end"/></w:r>
  </w:p>
  <w:tbl>
    <w:tr>
      <w:tc><w:p><w:r><w:t>Doc</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>WI-14</w:t></w:r></w:p></w:tc>
    </w:tr>
  </w:tbl>
  <w:p>
    <w:r><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:r>
  </w:p>
</w:hdr>`;
  const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:r><w:t xml:space="preserve">Controlled copy </w:t></w:r>
    <w:r><w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:instrText xml:space="preserve"> DATE \\@ "MMMM d, yyyy" </w:instrText></w:r>
    <w:r><w:fldChar w:fldCharType="end"/></w:r>
  </w:p>
</w:ftr>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header3.xml"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
  <Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer2.xml"/>
</Relationships>`;
  const headerRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/>
</Relationships>`;
  return officePackage([
    { name: "word/document.xml", data: Buffer.from(document) },
    { name: "word/_rels/document.xml.rels", data: Buffer.from(rels) },
    { name: "word/header1.xml", data: Buffer.from(header) },
    { name: "word/header2.xml", data: Buffer.from(`<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>FIRST PAGE HEADER</w:t></w:r></w:p></w:hdr>`) },
    { name: "word/header3.xml", data: Buffer.from(`<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>EVEN HEADER</w:t></w:r></w:p></w:hdr>`) },
    { name: "word/footer1.xml", data: Buffer.from(footer) },
    { name: "word/footer2.xml", data: Buffer.from(`<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>First footer</w:t></w:r></w:p></w:ftr>`) },
    { name: "word/_rels/header1.xml.rels", data: Buffer.from(headerRels) },
    { name: "word/media/logo.png", data: PNG },
  ]);
}

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
    expect(imported.html).toContain("Work instruction");
    expect(imported.html).toContain("Check the bore");
    expect(imported.html).toContain("Next page");
    expect(imported.header).toBeNull();
    expect(imported.footer).toBeNull();
  });

  it("imports a Word header and footer, stores them, and exports the same bands", async () => {
    const imported = htmlFromDocx(wordWithHeader());
    expect(imported.html).toContain("Work instruction body");
    expect(imported.header?.defaultHtml).toContain("<b>ACME Quality</b>");
    expect(imported.header?.defaultHtml).toContain("text-align:center");
    expect(imported.header?.defaultHtml).toContain('data-doc-field="page"');
    expect(imported.header?.defaultHtml).toContain('data-doc-field="pages"');
    expect(imported.header?.defaultHtml).toContain("<table>");
    expect(imported.header?.defaultHtml).toContain("WI-14");
    expect(imported.header?.defaultHtml).toContain(`data:image/png;base64,${PNG.toString("base64")}`);
    expect(imported.header?.differentFirstPage).toBe(true);
    expect(imported.header?.differentOddEven).toBe(true);
    expect(imported.header?.firstHtml).toContain("FIRST PAGE HEADER");
    expect(imported.header?.evenHtml).toContain("EVEN HEADER");
    expect(imported.footer?.defaultHtml).toContain("Controlled copy");
    expect(imported.footer?.defaultHtml).toContain('data-doc-field="date"');
    expect(imported.footer?.firstHtml).toContain("First footer");
    expect(imported.footer?.differentFirstPage).toBe(true);
    expect(imported.footer?.differentOddEven).toBe(true);

    const stored = JSON.parse(JSON.stringify({ html: imported.html, header: imported.header, footer: imported.footer })) as {
      html: string;
      header: NonNullable<typeof imported.header>;
      footer: NonNullable<typeof imported.footer>;
    };
    const exported = await docxFromHtml(stored.html, { docId: "WI-14", rev: "C" }, { header: stored.header, footer: stored.footer });
    const again = htmlFromDocx(exported);
    expect(again.header).toEqual(stored.header);
    expect(again.footer).toEqual(stored.footer);
    expect(again.html).toContain("Work instruction body");
  });
});
