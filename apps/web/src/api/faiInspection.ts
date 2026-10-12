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
  ncrId?: number | null;
  signature?: string | null;
  lines?: FaiResultLine[];
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

export const faiInspectionApi = {
  dashboard: () => apiClient.get(`${base}/dashboard`).then((r) => r.data as FaiDashboard),
  plans: {
    list: (q?: string) => apiClient.get(`${base}/plans`, { params: { q } }).then((r) => r.data as FaiPlan[]),
    get: (id: number) => apiClient.get(`${base}/plans/${id}`).then((r) => r.data as FaiPlan),
    create: (body: any) => apiClient.post(`${base}/plans`, body).then((r) => r.data),
    update: (id: number, body: any) => apiClient.put(`${base}/plans/${id}`, body).then((r) => r.data),
  },
  sources: {
    list: (status?: string) => apiClient.get(`${base}/sources`, { params: { status } }).then((r) => r.data as FaiSource[]),
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
    pdfUrl: (id: number) => `${base}/records/${id}/pdf`,
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
};
