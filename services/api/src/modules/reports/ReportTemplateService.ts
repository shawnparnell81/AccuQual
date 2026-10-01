import { isReportKind, reportTemplateDocument, reportTitle, templateFor, REPORT_TEMPLATE_VERSION, type ReportKind } from "./reports.model.js";

/** Serves the versioned JSON templates. Nothing here reads module tables. */
export const ReportTemplateService = {
  version: REPORT_TEMPLATE_VERSION,

  list() {
    return reportTemplateDocument();
  },

  get(key: string) {
    if (!isReportKind(key)) return null;
    const document = reportTemplateDocument();
    return document.templates.find((template) => template.key === key) ?? null;
  },

  sections(kind: ReportKind) {
    return templateFor(kind).map((spec) => ({ key: spec.key, title: spec.title }));
  },

  title(kind: ReportKind) {
    return reportTitle(kind);
  },
};
