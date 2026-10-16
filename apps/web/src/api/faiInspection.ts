import { apiClient } from "./client.js";

export interface FaiPlan {
  id: number;
  partNumber: string;
  partDescription?: string | null;
  productFamily?: string | null;
  supplierId?: number | null;
  supplierFactory?: string | null;
  receivingLocation?: string | null;
  riskClass: string;
  revision: number;
  status: string;
  repeatIntervalMonths: number;
  majorAql: string;
  minorAql: string;
  notes?: string | null;
  characteristics?: FaiCharacteristic[];
}

export interface FaiCharacteristic {
  id?: number;
  name: string;
  charType: string;
  limitType: string;
  nominal?: string | null;
  tolerancePlus?: string | null;
  toleranceMinus?: string | null;
  percent?: string | null;
  specMin?: string | null;
  specMax?: string | null;
  unit?: string | null;
  method?: string | null;
  sortOrder?: number;
}

export interface FaiSource {
  id: number;
  partNumber: string;
  supplierId?: number | null;
  supplierFactory?: string | null;
  receivingLocation?: string | null;
  status: string;
  lastFaiDate?: string | null;
  lastResult?: string | null;
  nextDueDate?: string | null;
  /** Phase 2: "due_soon" (within 30 days), "overdue", or null. Computed, not stored. */
  dueStatus?: "due_soon" | "overdue" | null;
}

export interface FaiSourceInput {
  partNumber: string;
  supplierId?: number | null;
  supplierFactory?: string | null;
  receivingLocation?: string | null;
  status?: string;
}

export interface FaiDashboard {
  open: number;
  awaitingSignoff: number;
  failed90: number;
  due30: number;
  overdue: number;
  notApproved: number;
  pullsPending: number;
  pullsOverdue: number;
}

export interface FaiRandomPullRules {
  id: number;
  pickMode: "percent" | "count";
  pickPercent?: number | null;
  pickCount?: number | null;
  productFamily?: string | null;
  riskClass?: string | null;
  siteId?: number | null;
  excludeMonths: number;
}

export interface FaiRandomPullItem {
  id: number;
  batchId: number;
  sourceId: number;
  partNumber: string | null;
  supplierFactory?: string | null;
  receivingLocation?: string | null;
  linkedRecordId?: number | null;
  linkedFaiNumber?: string | null;
  status: "pending" | "linked" | "completed_pass" | "completed_fail";
}

export interface FaiRandomPullBatch {
  id: number;
  year: number;
  status: "pending_approval" | "approved";
  generatedAt?: string | null;
  approvedAt?: string | null;
  items: FaiRandomPullItem[];
}

export interface FaiRandomPullCompliance {
  year: number;
  picked: number;
  completed: number;
  overdue: number;
}

/* ---------------- Phase 3: distribution lists, charts, reports ---------------- */

export type FaiDistributionMember = { type: "user"; userId: number } | { type: "email"; email: string };

export interface FaiDistributionList {
  id: number;
  name: string;
  members: FaiDistributionMember[];
  matchSiteId?: number | null;
  matchProductFamily?: string | null;
  matchTriggerReason?: string | null;
  matchEventTypes: string[];
  mondaySummary: boolean;
}

export const FAI_EVENT_TYPES = [
  { key: "awaiting_signoff", label: "FAI awaiting sign-off" },
  { key: "passed", label: "FAI signed passed" },
  { key: "failed", label: "FAI signed failed" },
  { key: "due_reminder", label: "Source due in 30 days / overdue" },
  { key: "random_pull_approved", label: "Random pull list approved" },
] as const;

export interface FaiPassRatePoint { month: string; passed: number; failed: number; total: number; passRate: number }
export interface FaiTriggerReasonPoint { triggerReason: string; count: number }
export interface FaiSupplierFailurePoint { supplierName: string; failures: number }
export interface FaiAgingPoint { bucket: "0-7" | "8-30" | "31-60" | "60+"; count: number }

export interface FaiReportPreview { title: string; columns: string[]; rows: (string | number)[][] }
export interface FaiReportFilters {
  from?: string; to?: string; siteId?: number; supplierId?: number; partNumber?: string; productFamily?: string;
}
export const FAI_REPORT_KEYS = [
  { key: "aql-lot", label: "AQL Lot Report" },
  { key: "source-qualification", label: "Source Qualification Report" },
  { key: "random-pull-compliance", label: "Random Pull Compliance Report" },
  { key: "supplier-performance", label: "Supplier FAI Performance" },
] as const;

export interface FaiRecord {
  id: number;
  faiNumber: string;
  planId?: number | null;
  planRevision?: number | null;
  partNumber: string;
  supplierId?: number | null;
  supplierFactory?: string | null;
  receivingLocation?: string | null;
  triggerReason?: string | null;
  poReference?: string | null;
  lotSize?: number | null;
  sampleSize?: number | null;
  inspector?: string | null;
  datePulled?: string | null;
  dateLabReceived?: string | null;
  dateInspected?: string | null;
  status: string;
  overallResult?: string | null;
  comments?: string | null;
  inspectionLevel: string;
  severity: string;
  majorAql?: string | null;
  minorAql?: string | null;
  codeLetter?: string | null;
  aqlSampleSize?: number | null;
  acMajor?: number | null;
  reMajor?: number | null;
  acMinor?: number | null;
  reMinor?: number | null;
  linkedCsaFaiId?: number | null;
  linkedFuelPumpFaiId?: number | null;
  /** Generic link for every validation form other than CSA and Fuel Pump. */
  linkedValidationReportId?: number | null;
  linkedValidationFormType?: FaiValidationFormType | null;
  /** The family the record's plan points at, which decides the Attach button offered. Null when none matches. */
  productType?: FaiValidationFormType | null;
  ncrId?: number | null;
  /** The linked NCR's own number, once someone has typed it. */
  ncrNumber?: string | null;
  signature?: string | null;
  createdAt?: string;
  lines?: FaiResultLine[];
  attachedForms?: FaiAttachedForm[];
  /** Whether the caller can attach/detach a validation form — from the API, no role names on the client. */
  canEdit?: boolean;
}

export type FaiValidationFormType = "csa" | "fuel_pump" | "air_strut" | "air_spring" | "fuel_injector" | "brake_wear" | "electric_lift" | "regular_gas_lift" | "coil_spring" | "shock";

export interface FaiAttachedForm {
  formType: FaiValidationFormType;
  reportId: number;
  title: string;
  openPath: string;
}

export interface FaiResultLine {
  id: number;
  characteristicName: string;
  charType: string;
  limitType: string;
  nominal?: string | null;
  limitLow?: string | null;
  limitHigh?: string | null;
  unit?: string | null;
  method?: string | null;
  measuredValue?: string | null;
  attributeResult?: string | null;
  result?: string | null;
  defects: number;
}

const base = "/fai-inspection";

export interface FaiSampleTag {
  number: number;
  /** What the tag's barcode holds: <FAI number>-S<n>. */
  code: string;
  printedCount: number;
  lastPrintedAt: string | null;
}

export interface FaiSamples {
  faiNumber: string;
  sampleCount: number;
  /** The person has "Can print labels". */
  canPrint: boolean;
  samples: FaiSampleTag[];
}

export interface FaiLabelData {
  faiNumber: string;
  partNumber: string;
  lotReference: string;
  lotSize: number | null;
  date: string;
  sampleCount: number;
  companyName: string;
  defaultSize: string;
}

export interface FaiScanResponse {
  /** A scanned sample tag: the record to open with that sample highlighted. */
  sample: { recordId: number; faiNumber: string; partNumber: string; sampleNumber: number; sampleCount: number; code: string; path: string } | null;
  results: { type: "FAI plan" | "FAI record"; id: number; label: string; detail: string; path: string; date: string | null }[];
}

export const faiInspectionApi = {
  /** Scan to find: a part number, an FAI number or a sample-tag code. */
  scan: (code: string) => apiClient.get(`${base}/scan`, { params: { code } }).then((r) => r.data as FaiScanResponse),
  dashboard: () => apiClient.get(`${base}/dashboard`).then((r) => r.data as FaiDashboard),
  plans: {
    list: (q?: string) => apiClient.get(`${base}/plans`, { params: { q } }).then((r) => r.data as FaiPlan[]),
    get: (id: number) => apiClient.get(`${base}/plans/${id}`).then((r) => r.data as FaiPlan),
    create: (body: any) => apiClient.post(`${base}/plans`, body).then((r) => r.data),
    update: (id: number, body: any) => apiClient.put(`${base}/plans/${id}`, body).then((r) => r.data),
  },
  sources: {
    list: (status?: string) => apiClient.get(`${base}/sources`, { params: { status } }).then((r) => r.data as FaiSource[]),
    create: (body: FaiSourceInput) => apiClient.post(`${base}/sources`, body).then((r) => r.data as FaiSource),
    update: (id: number, body: Partial<FaiSourceInput>) => apiClient.put(`${base}/sources/${id}`, body).then((r) => r.data as FaiSource),
    delete: (id: number) => apiClient.delete(`${base}/sources/${id}`).then((r) => r.data),
    setStatus: (id: number, body: { pin: string; certified: true; status: string; reason: string; description: string }) =>
      apiClient.post(`${base}/sources/${id}/status`, body).then((r) => r.data),
  },
  records: {
    list: (params?: { status?: string; q?: string }) => apiClient.get(`${base}/records`, { params }).then((r) => r.data as FaiRecord[]),
    get: (id: number) => apiClient.get(`${base}/records/${id}`).then((r) => r.data as FaiRecord),
    create: (body: any) => apiClient.post(`${base}/records`, body).then((r) => r.data),
    update: (id: number, body: any) => apiClient.patch(`${base}/records/${id}`, body).then((r) => r.data),
    delete: (id: number) => apiClient.delete(`${base}/records/${id}`).then((r) => r.data),
    saveLines: (id: number, lines: { id: number; measuredValue?: string | null; attributeResult?: string | null; defects: number }[]) =>
      apiClient.post(`${base}/records/${id}/lines`, { lines }).then((r) => r.data as FaiRecord),
    sign: (id: number, body: { pin: string; certified: true; outcome: "passed" | "failed"; description: string }) =>
      apiClient.post(`${base}/records/${id}/sign`, body).then((r) => r.data),
    attachForm: (id: number, formType: FaiValidationFormType) => apiClient.post(`${base}/records/${id}/attach-form`, { formType }).then((r) => r.data as FaiRecord),
    detachForm: (id: number, formType: FaiValidationFormType) => apiClient.post(`${base}/records/${id}/detach-form`, { formType }).then((r) => r.data as FaiRecord),
    samples: (id: number) => apiClient.get(`${base}/records/${id}/samples`).then((r) => r.data as FaiSamples),
    labelData: (id: number) => apiClient.get(`${base}/records/${id}/labels`).then((r) => r.data as FaiLabelData),
    printLabels: (id: number, body: { samples: number[]; size: string }) =>
      apiClient.post(`${base}/records/${id}/labels/print`, body).then((r) => r.data as { labels: { number: number; code: string }[]; count: number }),
    submitForSignoff: (id: number) => apiClient.post(`${base}/records/${id}/submit-signoff`).then((r) => r.data as FaiRecord),
    createNcr: (id: number) => apiClient.post(`${base}/records/${id}/ncr`).then((r) => r.data as { id: number; existing: boolean }),
    pdfUrl: (id: number) => `${base}/records/${id}/pdf`,
    /** The report needs the signed-in session, so it is fetched through the API client, not opened as a page link. */
    downloadPdf: async (id: number, fileName: string) => {
      const response = await apiClient.get(`${base}/records/${id}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data as Blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  },
  randomPulls: {
    getRules: () => apiClient.get(`${base}/random-pulls/rules`).then((r) => r.data as FaiRandomPullRules),
    updateRules: (body: Partial<FaiRandomPullRules>) => apiClient.put(`${base}/random-pulls/rules`, body).then((r) => r.data as FaiRandomPullRules),
    listBatches: (year?: number) => apiClient.get(`${base}/random-pulls/batches`, { params: { year } }).then((r) => r.data as FaiRandomPullBatch[]),
    getBatch: (id: number) => apiClient.get(`${base}/random-pulls/batches/${id}`).then((r) => r.data as FaiRandomPullBatch),
    generate: (year?: number) => apiClient.post(`${base}/random-pulls/batches`, { year }).then((r) => r.data as FaiRandomPullBatch),
    approve: (id: number, body: { pin: string; certified: true; description: string }) =>
      apiClient.post(`${base}/random-pulls/batches/${id}/approve`, body).then((r) => r.data as FaiRandomPullBatch),
    linkItem: (itemId: number, recordId: number) => apiClient.post(`${base}/random-pulls/items/${itemId}/link`, { recordId }).then((r) => r.data),
    compliance: (year: number) => apiClient.get(`${base}/random-pulls/compliance`, { params: { year } }).then((r) => r.data as FaiRandomPullCompliance),
  },
  distributionLists: {
    list: () => apiClient.get(`${base}/distribution-lists`).then((r) => r.data as FaiDistributionList[]),
    create: (body: Partial<FaiDistributionList>) => apiClient.post(`${base}/distribution-lists`, body).then((r) => r.data as FaiDistributionList),
    update: (id: number, body: Partial<FaiDistributionList>) => apiClient.patch(`${base}/distribution-lists/${id}`, body).then((r) => r.data as FaiDistributionList),
    delete: (id: number) => apiClient.delete(`${base}/distribution-lists/${id}`).then((r) => r.data),
  },
  charts: {
    passRateByMonth: () => apiClient.get(`${base}/charts/pass-rate-by-month`).then((r) => r.data as FaiPassRatePoint[]),
    byTriggerReason: () => apiClient.get(`${base}/charts/by-trigger-reason`).then((r) => r.data as FaiTriggerReasonPoint[]),
    failuresBySupplier: () => apiClient.get(`${base}/charts/failures-by-supplier`).then((r) => r.data as FaiSupplierFailurePoint[]),
    aging: () => apiClient.get(`${base}/charts/aging`).then((r) => r.data as FaiAgingPoint[]),
  },
  reports: {
    preview: (reportKey: string, filters: FaiReportFilters) => apiClient.get(`${base}/reports/${reportKey}/preview`, { params: filters }).then((r) => r.data as FaiReportPreview),
    /** Fetches with the real auth header (a plain `<a href>` can't carry it) and triggers a real file download, same pattern as ImportedDataPage.tsx's downloadOriginal(). */
    download: async (reportKey: string, format: "pdf" | "excel", filters: FaiReportFilters) => {
      const res = await apiClient.get(`${base}/reports/${reportKey}/export`, { params: { ...filters, format }, responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${reportKey}-${new Date().toISOString().slice(0, 10)}.${format === "excel" ? "xlsx" : "pdf"}`;
      link.click();
      URL.revokeObjectURL(url);
    },
  },
};
