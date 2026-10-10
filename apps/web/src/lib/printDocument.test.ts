import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  canPrintAccess,
  formatPrintFooter,
  formatPrintStamp,
  isPdfBytes,
  needsLandscape,
  offersScreenPrint,
  presentPdf,
  PRINT_NOT_DOCUMENT,
  printShouldToast,
  readFormIdentity,
  revisionToken,
  uploadedPrintChoice,
} from "./printDocument.ts";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function walkTsx(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...walkTsx(path));
    else if (name.endsWith(".tsx")) found.push(path);
  }
  return found;
}

describe("print document", () => {
  it("treats a PDF header as a document and rejects an error page", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    assert.equal(isPdfBytes(pdf), true);
    assert.equal(isPdfBytes(new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c])), false);
    assert.equal(isPdfBytes(new Uint8Array()), false);
  });

  it("toasts only when printing actually failed", () => {
    assert.equal(printShouldToast("dialog"), false);
    assert.equal(printShouldToast("download"), false);
    assert.equal(printShouldToast("failed"), true);
  });

  it("rejects bytes that are not a PDF before opening a frame", async () => {
    await assert.rejects(() => presentPdf(new TextEncoder().encode("<html>no</html>"), "form.pdf"), {
      message: PRINT_NOT_DOCUMENT,
    });
  });

  it("lets anyone who can view a record print it", () => {
    assert.equal(canPrintAccess("read"), true);
    assert.equal(canPrintAccess("edit"), true);
    assert.equal(canPrintAccess("any"), true);
    assert.equal(canPrintAccess(undefined), true);
    assert.equal(canPrintAccess("none"), false);
  });

  it("offers print on a grid, a saved copy, and a blank record", () => {
    assert.equal(offersScreenPrint("/validation-reports/9"), true);
    assert.equal(offersScreenPrint("/iso-forms/record/4"), true);
    assert.equal(offersScreenPrint("/qms-forms/incoming_inspection_record/2"), true);
    assert.equal(offersScreenPrint("/fai/records/3"), true);
    assert.equal(offersScreenPrint("/documents/master-list"), true);
    assert.equal(offersScreenPrint("/documents/internal-audit-schedule"), true);
    assert.equal(offersScreenPrint("/documents/engineering-request-log"), true);
    assert.equal(offersScreenPrint("/calibration/master-list"), true);
    assert.equal(offersScreenPrint("/blank-forms"), false);
    assert.equal(offersScreenPrint("/documents/folders"), false);
    assert.equal(offersScreenPrint("/form-builder/1"), false);
    assert.equal(offersScreenPrint("/form-builder"), false);
    assert.equal(offersScreenPrint("/form-builder/fills/1"), true);
    assert.equal(offersScreenPrint("/form-builder/template/4"), true);
    assert.equal(offersScreenPrint("/ncr/9"), true);
    assert.equal(offersScreenPrint("/workflow"), false);
  });

  it("prints a PDF or image upload, and an Office file only when a PDF rendition exists", () => {
    assert.equal(uploadedPrintChoice("pdf", false), "pdf");
    assert.equal(uploadedPrintChoice("image", false), "image");
    assert.equal(uploadedPrintChoice("office", true), "pdf");
    assert.equal(uploadedPrintChoice("office", false), "download");
    assert.equal(uploadedPrintChoice("download", false), "download");
  });

  it("reads the Doc ID and Rev shown on the form", () => {
    assert.deepEqual(readFormIdentity("Doc ID: FRM-VAL-001 · Rev: C"), { docId: "FRM-VAL-001", rev: "C" });
    assert.deepEqual(readFormIdentity("FRM-TST-001 Rev A"), { docId: "FRM-TST-001", rev: "A" });
    assert.deepEqual(readFormIdentity("Review the open items"), { docId: "", rev: "" });
    assert.deepEqual(readFormIdentity("DEMO-NCR-002 Revision: Date Issued NCR-002"), { docId: "DEMO-NCR-002", rev: "" });
    assert.deepEqual(readFormIdentity("FRM-NCR-001 DEMO-NCR-002"), { docId: "FRM-NCR-001", rev: "" });
    assert.equal(revisionToken("Date"), "");
    assert.equal(revisionToken("C"), "C");
    assert.equal(formatPrintStamp(new Date("2026-10-10T19:31:00.000Z")), "Oct 10, 2026, 3:31 PM ET");
  });

  it("names who printed the record and when", () => {
    assert.equal(
      formatPrintFooter({ docId: "FRM-VAL-001", rev: "C", printedBy: "Shawn", printedAt: "Oct 7, 2026, 2:30 PM" }),
      "FRM-VAL-001 · Rev C · Printed Oct 7, 2026, 2:30 PM · Shawn",
    );
  });

  it("uses landscape for a wide grid and portrait when the sheet fits", () => {
    assert.equal(needsLandscape([{ wideClass: true, contentSized: false, scrollWidth: 400, clientWidth: 400 }]), true);
    assert.equal(needsLandscape([{ wideClass: false, contentSized: true, scrollWidth: 1500, clientWidth: 1500 }]), true);
    assert.equal(needsLandscape([{ wideClass: false, contentSized: false, scrollWidth: 1400, clientWidth: 1400 }]), false);
    assert.equal(needsLandscape([{ wideClass: false, contentSized: true, scrollWidth: 640, clientWidth: 640 }]), false);
  });

  it("puts the shared Print control on the frame, saved forms, and an uploaded PDF", () => {
    const frame = readFileSync(join(srcRoot, "components/records/RecordFrame.tsx"), "utf8");
    const button = readFileSync(join(srcRoot, "components/records/PrintRecordButton.tsx"), "utf8");
    const chrome = readFileSync(join(srcRoot, "components/records/PrintChrome.tsx"), "utf8");
    const kept = readFileSync(join(srcRoot, "components/layout/KeptSection.tsx"), "utf8");
    const split = readFileSync(join(srcRoot, "components/layout/SplitWorkspace.tsx"), "utf8");
    const validation = readFileSync(join(srcRoot, "routes/ValidationReports/ValidationReportDetailPage.tsx"), "utf8");
    const preview = readFileSync(join(srcRoot, "components/shared/InAppFilePreview.tsx"), "utf8");
    const editor = readFileSync(join(srcRoot, "components/forms/FormEditor.tsx"), "utf8");
    assert.match(frame, /PrintRecordButton/);
    assert.match(button, /data-testid="print-record"/);
    assert.match(button, /canPrintAccess/);
    assert.match(chrome, /PrintRecordButton/);
    assert.match(kept, /<PrintChrome\b/);
    assert.match(split, /KeptSectionStack/);
    assert.match(validation, /RecordFrame/);
    assert.match(editor, /PrintRecordButton/);
    assert.match(preview, /data-testid="print-file"/);
    assert.match(preview, /uploadedPrintChoice/);
    assert.equal(preview.match(/data-testid="print-file"/g)?.length, 1);
    assert.equal(editor.match(/<PrintRecordButton\b/g)?.length, 1);
  });

  it("keeps a single Print control on each record view", () => {
    // These pages are not record views. A label, the monthly report, and routes the app no longer mounts.
    const outside = new Set([
      "LotLabelPrint.tsx",
      "EngineeringMonthlyReport.tsx",
      "ErpPurchaseOrderDetailPage.tsx",
      "ErpRequisitionDetailPage.tsx",
      "RmaLogDetailPage.tsx",
    ]);
    const files = walkTsx(join(srcRoot, "routes"));
    for (const file of files) {
      const name = basename(file);
      if (outside.has(name)) continue;
      const source = readFileSync(file, "utf8");
      assert.equal(source.match(/<PrintFormButton\b/g)?.length ?? 0, 0, name);
      assert.equal(source.match(/window\.print\s*\(/g)?.length ?? 0, 0, name);
      assert.equal(source.match(/<PrintRecordButton\b/g)?.length ?? 0, 0, name);
    }
    for (const host of ["components/records/RecordFrame.tsx", "components/records/PrintChrome.tsx", "components/forms/FormEditor.tsx"]) {
      const source = readFileSync(join(srcRoot, host), "utf8");
      assert.equal(source.match(/<PrintRecordButton\b/g)?.length, 1, host);
      assert.equal(source.match(/window\.print\s*\(/g)?.length ?? 0, 0, host);
    }
    const validation = readFileSync(join(srcRoot, "routes/ValidationReports/ValidationReportDetailPage.tsx"), "utf8");
    const iso = readFileSync(join(srcRoot, "routes/IsoForms/IsoFormDetailPage.tsx"), "utf8");
    assert.match(validation, /validation-report-print/);
    assert.match(iso, /aq-print-wide/);
    const preview = readFileSync(join(srcRoot, "components/shared/InAppFilePreview.tsx"), "utf8");
    const office = readFileSync(join(srcRoot, "components/documents/OnlyOfficeEditor.tsx"), "utf8");
    assert.ok(preview.indexOf("<OnlyOfficeEditor") < preview.indexOf('data-testid="print-file"'));
    assert.equal(preview.match(/data-testid="print-file"/g)?.length, 1);
    assert.equal(office.match(/data-testid="print-file"/g)?.length, 1);
  });

  it("hides app chrome, forces light paper, and landscapes wide grids", () => {
    const css = readFileSync(join(srcRoot, "styles/globals.css"), "utf8");
    const printAt = css.indexOf("@media print {");
    const printCss = css.slice(printAt, css.indexOf("@media (prefers-reduced-motion", printAt));
    assert.match(printCss, /\.aq-sidebar/);
    assert.match(printCss, /\.aq-topbar/);
    assert.match(printCss, /button/);
    assert.match(printCss, /color-scheme:\s*light\s*!important/);
    assert.match(printCss, /background:\s*#fff\s*!important/);
    assert.match(printCss, /@page wide-sheet \{\s*size:\s*letter landscape/);
    assert.match(printCss, /html\.aq-print-landscape/);
    assert.match(printCss, /\.aq-print-footer/);
    assert.match(printCss, /counter\(page\)/);
    assert.match(printCss, /counter\(pages\)/);
    assert.match(printCss, /aq-print-isolated/);
    assert.match(printCss, /\.aq-print-stack > \* \{[^}]*break-inside:\s*auto/);
    assert.match(printCss, /min-height:\s*0 !important/);
    const paper = css.slice(css.indexOf(".aq-paper {"));
    assert.match(paper, /\.aq-paper \{\s*background:\s*#fff !important;\s*color:\s*#1a1a1a;\s*color-scheme:\s*light;/);
    assert.doesNotMatch(paper.slice(0, 400), /invert/);
    const office = readFileSync(join(srcRoot, "components/shared/officePreview.css"), "utf8");
    assert.match(office, /\.sheet-grid \{\s*[^}]*background:\s*#fff;/);
    assert.doesNotMatch(office, /hsl\(var\(--card\)\)/);
    assert.doesNotMatch(office, /filter\s*:/);
    const preview = readFileSync(join(srcRoot, "components/shared/InAppFilePreview.tsx"), "utf8");
    const pdf = readFileSync(join(srcRoot, "components/forms/PdfViewer.tsx"), "utf8");
    const docx = readFileSync(join(srcRoot, "components/shared/DocxPreviewPane.tsx"), "utf8");
    const sheet = readFileSync(join(srcRoot, "components/shared/SpreadsheetPreviewPane.tsx"), "utf8");
    assert.match(pdf, /aq-paper/);
    assert.match(docx, /aq-paper/);
    assert.match(sheet, /aq-paper/);
    assert.match(preview, /aq-paper/);
  });
});
