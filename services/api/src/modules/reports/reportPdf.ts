import type { FormLayout } from "../forms/layouts/types.js";
import { renderFormLayoutAsPdf } from "../forms/schema-pdf-renderer.js";
import { emptyFrame, type ControlledPdfFrame } from "../forms/controlledPdf.js";
import type { PdfChrome } from "../pdf-exports/pdfExportStore.js";
import { applyChrome } from "../pdf-exports/pdfExportStore.js";
import type { QualityReport } from "./reports.model.js";

/** PDF of a quality report that has already been built. Sections are not added or dropped here. */
export async function renderQualityReportPdf(report: QualityReport, chrome?: PdfChrome | null): Promise<Uint8Array> {
  const data: Record<string, unknown> = {
    plant: report.header.plant.name,
    range: `${report.header.dateRange.from.slice(0, 10)} to ${report.header.dateRange.to.slice(0, 10)}`,
    generated: `${report.header.generatedAt} by ${report.header.generatedBy.name}`,
  };
  const layout: FormLayout = {
    formType: "quality_report",
    title: report.header.title,
    sections: [
      {
        number: "1",
        title: "Report",
        blocks: [
          {
            type: "row",
            fields: [
              { kind: "text", name: "plant", label: "Plant" },
              { kind: "text", name: "range", label: "Date range" },
              { kind: "text", name: "generated", label: "Generated" },
            ],
          },
        ],
      },
      ...report.sections.map((section, index) => {
        const summaryNames = Object.keys(section.summary).slice(0, 6);
        for (const key of summaryNames) data[`sum_${section.key}_${key}`] = section.summary[key] == null ? "" : String(section.summary[key]);
        if (section.reason) data[`reason_${section.key}`] = section.reason;
        data[`rows_${section.key}`] = section.rows.map((row) => ({ label: row.label, value: row.value == null ? "" : String(row.value) }));
        return {
          number: String(index + 2),
          title: section.title,
          blocks: [
            ...(section.reason
              ? [{ type: "row" as const, fields: [{ kind: "text" as const, name: `reason_${section.key}`, label: "Note" }] }]
              : []),
            ...(summaryNames.length > 0
              ? [
                  {
                    type: "row" as const,
                    fields: summaryNames.map((key) => ({ kind: "text" as const, name: `sum_${section.key}_${key}`, label: key })),
                  },
                ]
              : []),
            {
              type: "table" as const,
              name: `rows_${section.key}`,
              columns: [
                { key: "label", label: "Item", kind: "text" as const },
                { key: "value", label: "Value", kind: "text" as const },
              ],
            },
          ],
        };
      }),
    ],
  };
  const built = emptyFrame({
    sourceModule: report.header.title,
    recordNumber: report.header.title,
    revision: String(report.header.templateVersion),
    generatedBy: report.header.generatedBy.name,
    generatedAt: new Date(report.header.generatedAt),
    formNumber: report.header.templateKey,
    status: null,
  });
  const frame: ControlledPdfFrame = chrome ? applyChrome(built, chrome) : built;
  return renderFormLayoutAsPdf(layout, data, frame);
}
