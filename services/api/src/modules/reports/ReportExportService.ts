import { PDF_STUB_MESSAGE, reportFileName, reportToCsv, type QualityReport, type ReportKind } from "./reports.model.js";

/** CSV and JSON are real files. PDF is a stub and is not rendered. */
export const ReportExportService = {
  csv(report: QualityReport): { body: string; fileName: string; contentType: string } {
    return {
      body: reportToCsv(report),
      fileName: reportFileName(report.header.type, "csv"),
      contentType: "text/csv; charset=utf-8",
    };
  },

  json(report: QualityReport): { body: string; fileName: string; contentType: string } {
    return {
      body: JSON.stringify(report, null, 2),
      fileName: reportFileName(report.header.type, "json"),
      contentType: "application/json; charset=utf-8",
    };
  },

  pdfStub(): { status: "stub"; format: "pdf"; message: string } {
    return { status: "stub", format: "pdf", message: PDF_STUB_MESSAGE };
  },

  fileName(kind: ReportKind, format: "csv" | "json") {
    return reportFileName(kind, format);
  },
};
