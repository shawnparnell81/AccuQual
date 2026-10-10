export type LaborClaimStatus = "open" | "pending" | "approved" | "denied" | "closed";

export interface LaborClaim {
  id: number;
  claimNumber: string | null;
  claimDate: string | null;
  customerName: string | null;
  partName: string | null;
  laborHours: string | null;
  laborRate: string | null;
  totalLaborCost: string | null;
  warrantyClaimId: number | null;
  ncrId: number | null;
  status: LaborClaimStatus;
  notes: string | null;
  siteId: number | null;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string | null;
  warrantyClaim?: { id: number; claimNumber: string | null; status: string } | null;
  linkedNcr?: { id: number; title: string; status: string } | null;
}
