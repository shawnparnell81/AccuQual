import { useQuery } from "@tanstack/react-query";
import { apiClient } from "./client";
import { REVIEWER_ROLES } from "./versioning";
import { useCurrentUser } from "../hooks/useAuth";

// Client for the Quarantine module (services/api/src/modules/quarantine).

export type QuarantineStatus = "quarantined" | "released" | "destroyed";
export type QuarantineItemType = "inventory_lot" | "inventory_item" | "finished_goods" | "work_in_process" | "equipment" | "other";
export type QuarantineReason = "nonconforming_material" | "failed_inspection" | "calibration_failure" | "supplier_recall" | "customer_return" | "suspect_contamination" | "other";

export const ITEM_TYPE_LABEL: Record<QuarantineItemType, string> = {
  inventory_lot: "Inventory lot (enforced)",
  inventory_item: "Inventory item (enforced)",
  finished_goods: "Finished goods (record only)",
  work_in_process: "Work in process (record only)",
  equipment: "Equipment (record only)",
  other: "Something else (record only)",
};
export const REASON_LABEL: Record<QuarantineReason, string> = {
  nonconforming_material: "Nonconforming material",
  failed_inspection: "Failed inspection",
  calibration_failure: "Calibration failure",
  supplier_recall: "Supplier recall",
  customer_return: "Customer return",
  suspect_contamination: "Suspect contamination",
  other: "Other",
};
export const RELEASE_LABEL: Record<string, string> = { use_as_is: "Use as is", reworked: "Reworked", sorted: "Sorted (good pieces released)" };
export const DESTROY_LABEL: Record<string, string> = { scrapped: "Scrapped", returned_to_supplier: "Returned to supplier", other: "Removed another way" };

export interface QuarantineRecord {
  id: number;
  itemType: QuarantineItemType;
  itemId: number | null;
  itemLabel: string;
  lotNumber: string | null;
  quantity: string;
  originalQuantity: string;
  unit: string | null;
  reasonCategory: QuarantineReason;
  reason: string;
  status: QuarantineStatus;
  enforced: boolean;
  sourceType: string | null;
  sourceId: number | null;
  ncrId: number | null;
  createdBy: number | null;
  createdAt: string | null;
  releasedAt: string | null;
  destroyedAt: string | null;
  ageDays: number;
}

export interface QuarantineDetail extends QuarantineRecord {
  inventory: { id: number; location: string; quantity: string }[];
  resolutions: { id: number; action: "release" | "destroy"; disposition: string; quantity: string; notes: string; resolvedBy: number | null; resolvedAt: string | null }[];
}

export interface QuarantineSummary {
  openHolds: number;
  enforcedHolds: number;
  notEnforcedHolds: number;
  olderThan7Days: number;
  olderThan30Days: number;
  oldestDays: number;
  byReason: Record<string, number>;
}

export function useQuarantineList(filters: { status?: string; q?: string }) {
  return useQuery<QuarantineRecord[]>({ queryKey: ["quarantine", "list", filters], queryFn: async () => (await apiClient.get("/quarantine", { params: filters })).data });
}
export function useQuarantineSummary() {
  return useQuery<QuarantineSummary>({ queryKey: ["quarantine", "summary"], queryFn: async () => (await apiClient.get("/quarantine/summary")).data });
}
export function useQuarantineInventory() {
  return useQuery<{ rows: { id: number; quarantineId: number; location: string; quantity: string; itemLabel: string; unit: string | null; reasonCategory: QuarantineReason; enforced: boolean }[]; byLocation: { location: string; lines: number; quantity: number }[] }>({
    queryKey: ["quarantine", "inventory"],
    queryFn: async () => (await apiClient.get("/quarantine/inventory")).data,
  });
}
export function useQuarantine(id: number) {
  return useQuery<QuarantineDetail>({ queryKey: ["quarantine", "one", id], queryFn: async () => (await apiClient.get(`/quarantine/${id}`)).data });
}

/** May this person place / move holds (manage), and release / destroy them? The server decides; this only decides which buttons show. */
export function useQuarantineAccess() {
  const user = useCurrentUser();
  const reviewer = !!user?.roleName && REVIEWER_ROLES.includes(user.roleName);
  return { mayManage: reviewer || user?.department === "quality" || user?.department === "material_management", mayRelease: reviewer };
}
