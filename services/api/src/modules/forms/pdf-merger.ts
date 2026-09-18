import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { logger } from "../../utils/logger.js";
import type { FormTemplate } from "../../drizzle/schema/forms.js";
import { getFormLayout } from "./layouts/index.js";
import { renderFormLayoutAsPdf } from "./schema-pdf-renderer.js";
import { renderProcessFlowDiagramAsPdf } from "./diagram-pdf-renderer.js";

/**
 * Fills a template's AcroForm fields with `data` per `fieldMap` (DB field ->
 * PDF field name) and flattens it. AccuQual doesn't ship real template PDF
 * binaries in this repo (see forms & PDF Engine Spec §4's example field map),
 * so when the template file can't be read from disk, this falls back to:
 *   1. A schema-driven render (layouts/*.ts) when one exists for the form
 *      type — reproduces a real pasted document's layout (sections, tables,
 *      checkboxes) rather than a plain key:value dump.
 *   2. A plain key:value render otherwise.
 * Callers always get back a valid PDF, never an error.
 */
export async function mergePdfFields(template: FormTemplate, data: Record<string, unknown>): Promise<Uint8Array> {
  const templateBytes = await readTemplateFile(template.pdfPath);

  if (templateBytes) {
    try {
      return await fillAcroForm(templateBytes, template.fieldMap, data);
    } catch (err) {
      logger.warn(`Failed to fill AcroForm for template ${template.pdfPath}, falling back to schema/plain render`, err);
    }
  }

  const layout = getFormLayout(template.formType);
  if (layout) {
    if (template.formType === "process_flow_diagram") {
      return renderProcessFlowDiagramAsPdf(layout, data);
    }
    return renderFormLayoutAsPdf(layout, data);
  }

  return renderPlainPdf(template.formType, data);
}

async function readTemplateFile(pdfPath: string): Promise<Buffer | null> {
  try {
    return await readFile(pdfPath);
  } catch {
    return null; // template not on disk yet — expected for the seeded /templates/defaults/* paths
  }
}

async function fillAcroForm(templateBytes: Buffer, fieldMap: Record<string, string>, data: Record<string, unknown>): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();

  for (const [dbField, pdfFieldName] of Object.entries(fieldMap)) {
    const value = data[dbField];
    if (value === undefined || value === null) continue;
    try {
      form.getTextField(pdfFieldName).setText(String(value));
    } catch {
      try {
        form.getCheckBox(pdfFieldName)[value ? "check" : "uncheck"]();
      } catch {
        // Field not found on this template — skip rather than fail the whole export.
      }
    }
  }

  form.flatten();
  return pdfDoc.save();
}

async function renderPlainPdf(formType: string, data: Record<string, unknown>): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // US Letter
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = 740;
  page.drawText(`AccuQual — ${formType.toUpperCase()} Form`, { x: 50, y, size: 16, font: bold, color: rgb(0.1, 0.1, 0.1) });
  y -= 30;

  for (const [key, value] of Object.entries(data)) {
    if (y < 60) break; // single-page fallback is fine for a scaffold
    const text = `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`;
    page.drawText(text.slice(0, 100), { x: 50, y, size: 11, font, color: rgb(0.2, 0.2, 0.2) });
    y -= 18;
  }

  return pdfDoc.save();
}
