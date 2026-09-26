import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useCurrentUser } from "../../hooks/useAuth";
import { SelectField } from "../../components/forms/Field";
import { SupplierOnboardingPanel } from "./SupplierOnboardingPanel";
import { SupplierDocumentUploadPanel } from "./SupplierDocumentUploadPanel";
import { PPAPSubmissionPanel } from "./PPAPSubmissionPanel";
import { SupplierCARForm } from "./SupplierCARForm";
import { Supplier8DForm } from "./Supplier8DForm";
import { SupplierMessagingPanel } from "./SupplierMessagingPanel";
import { SupplierScorecard } from "./SupplierScorecard";
import { SupplierPerformanceDashboard } from "./SupplierPerformanceDashboard";
import { SupplierNCRList } from "./SupplierNCRList";
import { SupplierCAPAList } from "./SupplierCAPAList";
import { SupplierRmaList } from "./SupplierRmaList";
import { SupplierWarrantyList } from "./SupplierWarrantyList";
import { SupplierScarList } from "./SupplierScarList";
import { SupplierInspectionList } from "./SupplierInspectionList";
import { SupplierLotList } from "./SupplierLotList";
import { SupplierSettingsPanel } from "./SupplierSettingsPanel";
import { SupplierRmaRequestForm } from "./SupplierRmaRequestForm";
import { SupplierRmaRequestStatus } from "./SupplierRmaRequestStatus";
import type { Supplier } from "../../api/types";

const TABS: { key: TabKey; label: string; supplierOnly?: boolean }[] = [
  { key: "rma_request", label: "RMA Request", supplierOnly: true },
  { key: "onboarding", label: "Onboarding" },
  { key: "documents", label: "Documents" },
  { key: "ppap", label: "PPAP" },
  { key: "car", label: "Corrective Actions" },
  { key: "8d", label: "8D Responses" },
  { key: "messages", label: "Messages" },
  { key: "scorecard", label: "Scorecard" },
  { key: "performance", label: "Performance" },
  { key: "ncr", label: "NCRs" },
  { key: "capa", label: "CAPAs" },
  { key: "rma", label: "RMAs" },
  { key: "warranty", label: "Warranty" },
  { key: "scar", label: "SCARs" },
  { key: "inspections", label: "Inspections" },
  { key: "lots", label: "Shipment Lots" },
  { key: "settings", label: "Settings" },
];
type TabKey = "rma_request" | "onboarding" | "documents" | "ppap" | "car" | "8d" | "messages" | "scorecard" | "performance" | "ncr" | "capa" | "rma" | "warranty" | "scar" | "inspections" | "lots" | "settings";

// Panels that make sense listing "every supplier at once" when internal
// staff hasn't picked one — the rest inherently need exactly one supplier.
const ALL_SUPPLIER_TABS = new Set<TabKey>(["onboarding", "documents", "ppap", "car", "8d"]);

/**
 * The one entry point for both real audiences (see supplierPortal.controller
 * .ts's own comment): an external supplier login lands here with every panel
 * silently scoped to itself (no picker shown, no supplierId ever sent from
 * the client — the server always resolves it from the login), while internal
 * staff (Quality/Purchasing/Engineering) get a supplier picker up top since
 * they may review any of them.
 */
const TAB_KEYS = new Set<string>(TABS.map((t) => t.key));

export function SupplierPortalHome() {
  const currentUser = useCurrentUser();
  const isSupplier = currentUser?.roleName === "supplier";
  const isReviewer = !isSupplier && (currentUser?.roleName === "admin" || currentUser?.department === "quality" || currentUser?.department === "purchasing");
  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["suppliers"],
    queryFn: async () => (await apiClient.get("/suppliers")).data,
    enabled: !isSupplier,
  });
  // Full-System Audit finding L1 — read an optional ?supplierId=&tab=
  // pair from the URL so a "View Scorecard" link elsewhere (the Suppliers
  // roster) can land directly on a pre-selected supplier's scorecard,
  // without changing this page's own default behavior: no query params
  // (the existing path, e.g. the nav link into /supplier-portal) still
  // starts exactly as before — no supplier pre-selected, picker shown.
  const [searchParams] = useSearchParams();
  const initialSupplierId = !isSupplier ? Number(searchParams.get("supplierId")) || undefined : undefined;
  const initialTabParam = searchParams.get("tab");
  const initialTab: TabKey = (initialTabParam && TAB_KEYS.has(initialTabParam) ? initialTabParam : isSupplier ? "rma_request" : "onboarding") as TabKey;

  const [supplierId, setSupplierId] = useState<number | undefined>(initialSupplierId);
  const [tab, setTab] = useState<TabKey>(initialTab);

  const needsPicker = !isSupplier && !ALL_SUPPLIER_TABS.has(tab) && !supplierId;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Supplier Portal</h1>
        {!isSupplier && (
          <div className="w-64">
            <SelectField label="Supplier" value={supplierId ?? ""} onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : undefined)}>
              <option value="">{ALL_SUPPLIER_TABS.has(tab) ? "All suppliers" : "Select a supplier…"}</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </SelectField>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.filter((t) => isSupplier || !t.supplierOnly).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-t-md px-3 py-2 text-sm ${tab === t.key ? "border-b-2 border-primary font-medium text-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {needsPicker ? (
        <p className="text-sm text-muted-foreground">Select a supplier above to view this tab.</p>
      ) : (
        <>
          {tab === "rma_request" && isSupplier && (
            <div className="flex flex-col gap-4">
              <SupplierRmaRequestForm onSubmitted={() => {}} />
              <SupplierRmaRequestStatus />
            </div>
          )}
          {tab === "onboarding" && <SupplierOnboardingPanel supplierId={supplierId} isReviewer={isReviewer} />}
          {tab === "documents" && <SupplierDocumentUploadPanel supplierId={supplierId} />}
          {tab === "ppap" && <PPAPSubmissionPanel supplierId={supplierId} isReviewer={isReviewer} />}
          {tab === "car" && <SupplierCARForm supplierId={supplierId} isReviewer={isReviewer} />}
          {tab === "8d" && <Supplier8DForm supplierId={supplierId} isReviewer={isReviewer} />}
          {tab === "messages" && supplierId !== undefined && !isSupplier && <SupplierMessagingPanel supplierId={supplierId} />}
          {tab === "messages" && isSupplier && <SupplierMessagingPanel />}
          {tab === "scorecard" && <SupplierScorecard supplierId={supplierId} />}
          {tab === "performance" && <SupplierPerformanceDashboard supplierId={supplierId} />}
          {tab === "ncr" && <SupplierNCRList supplierId={supplierId} />}
          {tab === "capa" && <SupplierCAPAList supplierId={supplierId} />}
          {tab === "rma" && <SupplierRmaList supplierId={supplierId} />}
          {tab === "warranty" && <SupplierWarrantyList supplierId={supplierId} />}
          {tab === "scar" && <SupplierScarList supplierId={supplierId} />}
          {tab === "inspections" && <SupplierInspectionList supplierId={supplierId} />}
          {tab === "lots" && <SupplierLotList supplierId={supplierId} />}
          {tab === "settings" && <SupplierSettingsPanel supplierId={supplierId} />}
        </>
      )}
    </div>
  );
}
