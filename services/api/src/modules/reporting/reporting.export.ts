import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * Phase 6 "Add Export Options" — one shared shape every report export
 * builds from: a title, an audit-metadata line (who/when/tenant — "Ensure
 * exports include audit metadata"), and a flat table of rows. Each report
 * type's controller flattens its own reporting.service.ts result into this
 * shape once; the 3 format functions below never know which report they're
 * rendering.
 */
export interface ExportableReport {
  title: string;
  generatedAt: Date;
  generatedBy: string;
  companyName: string;
  columns: string[];
  rows: (string | number)[][];
}

export function toCsv(report: ExportableReport): string {
  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const meta = [`# ${report.title}`, `# Tenant: ${report.companyName}`, `# Generated: ${report.generatedAt.toISOString()} by ${report.generatedBy}`, ""];
  const lines = [report.columns.map(escape).join(","), ...report.rows.map((r) => r.map(escape).join(","))];
  return [...meta, ...lines].join("\n");
}

export async function toExcel(report: ExportableReport): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = report.generatedBy;
  workbook.created = report.generatedAt;
  const sheet = workbook.addWorksheet(report.title.slice(0, 31)); // Excel's own 31-char sheet-name limit

  sheet.addRow([report.title]).font = { bold: true, size: 14 };
  sheet.addRow([`Tenant: ${report.companyName}`]);
  sheet.addRow([`Generated: ${report.generatedAt.toLocaleString()} by ${report.generatedBy}`]);
  sheet.addRow([]);
  const headerRow = sheet.addRow(report.columns);
  headerRow.font = { bold: true };
  for (const row of report.rows) sheet.addRow(row);
  sheet.columns.forEach((col) => (col.width = 22));

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function toPdf(report: ExportableReport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([612, 792]); // US Letter
  let y = 750;
  const margin = 50;
  const lineHeight = 16;

  function ensureRoom() {
    if (y < margin + lineHeight) {
      page = doc.addPage([612, 792]);
      y = 750;
    }
  }

  page.drawText(report.title, { x: margin, y, size: 16, font: boldFont, color: rgb(0.1, 0.1, 0.15) });
  y -= lineHeight * 1.5;
  page.drawText(`Tenant: ${report.companyName}`, { x: margin, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
  y -= lineHeight;
  page.drawText(`Generated: ${report.generatedAt.toLocaleString()} by ${report.generatedBy}`, { x: margin, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
  y -= lineHeight * 1.5;

  page.drawText(report.columns.join("   |   "), { x: margin, y, size: 9, font: boldFont });
  y -= lineHeight;

  for (const row of report.rows) {
    ensureRoom();
    const text = row.map((c) => String(c)).join("   |   ");
    page.drawText(text.length > 110 ? text.slice(0, 107) + "..." : text, { x: margin, y, size: 9, font });
    y -= lineHeight;
  }

  return doc.save();
}
