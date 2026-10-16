/**
 * Records whose controlled PDF is built by the API. The Download PDF button
 * beside Print uses this list. Pages that already carry their own Download PDF
 * button (NCR, FAI inspection, CSA, Fuel Pump, FAI records, forms built on
 * FormEditor) are not listed, so the page never shows the button twice.
 */
export interface RecordPdfSource {
  method: "get" | "post";
  url: string;
  fileName: string;
}

const SOURCES: { test: RegExp; build: (id: number) => RecordPdfSource }[] = [
  { test: /^\/capa\/(\d+)$/, build: (id) => ({ method: "post", url: `/forms/capa/${id}/export`, fileName: `capa-${id}.pdf` }) },
  { test: /^\/8d\/(\d+)$/, build: (id) => ({ method: "post", url: `/forms/eight_d/${id}/export`, fileName: `8d-${id}.pdf` }) },
  { test: /^\/iso-forms\/record\/(\d+)$/, build: (id) => ({ method: "get", url: `/iso-quality-forms/${id}/pdf`, fileName: `iso-form-${id}.pdf` }) },
  { test: /^\/qms-forms\/[^/]+\/(\d+)$/, build: (id) => ({ method: "get", url: `/qms-forms/${id}/pdf`, fileName: `qms-form-${id}.pdf` }) },
  { test: /^\/validation-reports\/(\d+)$/, build: (id) => ({ method: "get", url: `/validation-reports/${id}/pdf`, fileName: `validation-report-${id}.pdf` }) },
];

export function recordPdfSource(pathname: string): RecordPdfSource | null {
  const path = pathname.split("?")[0] ?? pathname;
  for (const source of SOURCES) {
    const match = source.test.exec(path);
    if (match) return source.build(Number(match[1]));
  }
  return null;
}
