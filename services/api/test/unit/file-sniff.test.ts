import { describe, expect, it } from "vitest";
import { inlineMime, sniffPdf, sniffSpreadsheet, sniffUpload } from "../../src/utils/fileSniff.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const PDF = Buffer.from("%PDF-1.4 evidence");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);

function zip(marker: string): Buffer {
  return Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.from(marker)]);
}

describe("upload file sniffing", () => {
  it("accepts a PDF, image, Office file, or CSV only when the name matches the bytes", () => {
    expect(sniffUpload(PDF, "scan.pdf")?.mime).toBe("application/pdf");
    expect(sniffUpload(PNG, "photo.png")?.ext).toBe(".png");
    expect(sniffUpload(JPEG, "photo.jpg")?.mime).toBe("image/jpeg");
    expect(sniffUpload(JPEG, "photo.jpeg")?.ext).toBe(".jpeg");
    expect(sniffUpload(zip("word/document.xml"), "policy.docx")?.ext).toBe(".docx");
    expect(sniffUpload(zip("xl/workbook.xml"), "sheet.xlsx")?.ext).toBe(".xlsx");
    expect(sniffUpload(zip("ppt/slides"), "deck.pptx")?.ext).toBe(".pptx");
    expect(sniffUpload(OLE, "legacy.xls")?.ext).toBe(".xls");
    expect(sniffUpload(Buffer.from("name,qty\nBolt,2\n"), "parts.csv")?.mime).toBe("text/csv");
  });

  it("refuses a renamed executable, HTML, and a type that does not match the name", () => {
    expect(sniffUpload(Buffer.from("MZ fake"), "parts.csv")).toBeNull();
    expect(sniffUpload(Buffer.from("<html></html>"), "page.html")).toBeNull();
    expect(sniffUpload(PDF, "scan.png")).toBeNull();
    expect(sniffUpload(zip("word/"), "sheet.xlsx")).toBeNull();
    expect(sniffUpload(Buffer.from("name,qty\n\0"), "parts.csv")).toBeNull();
    expect(sniffUpload(Buffer.alloc(0), "empty.pdf")).toBeNull();
  });

  it("keeps certificate checks to PDF and spreadsheet imports to csv or excel", () => {
    expect(sniffPdf(PDF, "cert.pdf")?.ext).toBe(".pdf");
    expect(sniffPdf(PNG, "cert.png")).toBeNull();
    expect(sniffSpreadsheet(Buffer.from("a,b\n"), "list.csv")?.ext).toBe(".csv");
    expect(sniffSpreadsheet(PDF, "list.pdf")).toBeNull();
  });

  it("treats only a real image or PDF as safe to show in the browser", () => {
    expect(inlineMime(PDF)).toBe("application/pdf");
    expect(inlineMime(PNG)).toBe("image/png");
    expect(inlineMime(zip("word/"))).toBeNull();
    expect(inlineMime(Buffer.from("name,qty\n"))).toBeNull();
  });
});
