import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./client";
import type { CharacteristicInput, CharacteristicMode } from "../lib/faiLogic";

export interface FaiLookupPlan {
  id: number;
  name: string;
  scope: "part" | "family";
  partNumber: string | null;
  partName: string | null;
  productFamily: string | null;
  supplierId: number | null;
  currentRevision: number;
}

export interface FaiLookupPerson {
  id: number;
  name: string | null;
  email: string;
  department: string | null;
}

export interface FaiLookups {
  suppliers: { id: number; name: string; status: string }[];
  people: FaiLookupPerson[];
  plans: FaiLookupPlan[];
}

export interface FaiPlanSummary {
  id: number;
  name: string;
  scope: string;
  partNumber: string | null;
  partName: string | null;
  productFamily: string | null;
  supplierId: number | null;
  supplierName: string | null;
  cadenceMonths: number;
  currentRevision: number;
  retired: boolean;
}

export interface FaiPlanDetail extends FaiPlanSummary {
  notes: string | null;
  viewingRevision: number;
  readOnly: boolean;
  characteristics: CharacteristicInput[];
  revisions: { revision: number; cadenceMonths: number; createdAt: string | null }[];
}

export interface FaiLine {
  id: number;
  balloon: string | null;
  name: string;
  mode: CharacteristicMode;
  nominal: string | null;
  percent: string | null;
  plusTolerance: string | null;
  minusTolerance: string | null;
  limitLow: string | null;
  limitHigh: string | null;
  actual: string | null;
  attributeResult: string | null;
  result: string;
  limits: string;
}

export interface FaiRecordDetail {
  id: number;
  number: string;
  planId: number;
  planName: string;
  planRevision: number;
  partNumber: string;
  partName: string | null;
  supplierId: number;
  supplierName: string;
  status: "open" | "submitted" | "approved" | "rejected";
  comments: string | null;
  assignedTo: number | null;
  qualitySignature: string | null;
  ncrId: number | null;
  ncrNumber: string | null;
  lines: FaiLine[];
}

export interface FaiRecordSummary {
  id: number;
  number: string;
  partNumber: string;
  partName: string | null;
  supplierName: string;
  status: string;
  planRevision: number;
  createdAt: string | null;
}

export interface FaiSourceRow {
  id: number;
  partNumber: string;
  supplierName: string;
  status: "pending" | "approved" | "failed";
  lastPassDate: string | null;
  nextDueDate: string | null;
  cadenceMonths: number;
  lastFaiId: number | null;
  queue: "due_soon" | "overdue" | "failed" | null;
}

export interface FaiQueue {
  today: string;
  open: { id: number; number: string; partNumber: string; supplierName: string; status: string; assignedTo: number | null }[];
  dueSoon: FaiSourceRow[];
  overdue: FaiSourceRow[];
  failed: FaiSourceRow[];
}

export interface FaiPullList {
  today: string;
  due: { partNumber: string; partName: string | null; lastCompletedOn: string | null; openPullId: number | null; assignedTo: number | null }[];
}

export function useFaiLookups() {
  return useQuery({ queryKey: ["fai", "lookups"], queryFn: async () => (await apiClient.get<FaiLookups>("/fai/lookups")).data });
}

export function useFaiQueue() {
  return useQuery({ queryKey: ["fai", "queue"], queryFn: async () => (await apiClient.get<FaiQueue>("/fai/queue")).data });
}

export function useFaiPlans() {
  return useQuery({ queryKey: ["fai", "plans"], queryFn: async () => (await apiClient.get<FaiPlanSummary[]>("/fai/plans")).data });
}

export function useFaiPlan(id: number | null, revision?: number) {
  return useQuery({
    queryKey: ["fai", "plan", id, revision ?? "current"],
    enabled: id != null,
    queryFn: async () => (await apiClient.get<FaiPlanDetail>(`/fai/plans/${id}`, { params: revision ? { revision } : undefined })).data,
  });
}

export function useFaiRecords() {
  return useQuery({ queryKey: ["fai", "records"], queryFn: async () => (await apiClient.get<FaiRecordSummary[]>("/fai/records")).data });
}

export function useFaiRecord(id: number) {
  return useQuery({ queryKey: ["fai", "record", id], queryFn: async () => (await apiClient.get<FaiRecordDetail>(`/fai/records/${id}`)).data });
}

export function useFaiSources() {
  return useQuery({ queryKey: ["fai", "sources"], queryFn: async () => (await apiClient.get<FaiSourceRow[]>("/fai/sources")).data });
}

export function useFaiPulls() {
  return useQuery({ queryKey: ["fai", "pulls"], queryFn: async () => (await apiClient.get<FaiPullList>("/fai/pulls")).data });
}

export function useInvalidateFai() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["fai"] });
}
