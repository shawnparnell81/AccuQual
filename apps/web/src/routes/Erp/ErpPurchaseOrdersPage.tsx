import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { createResourceHooks } from "../../api/resourceHooks";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useCanEditWorkflow } from "../../hooks/useWorkflowAccess";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { DataTable } from "../../components/tables/DataTable";
import type { ErpPurchaseOrder, AiSuggestion, ErpAutomationSuggestion } from "../../api/types";

const poHooks = createResourceHooks<ErpPurchaseOrder>("erp/purchase-orders");

const SUGGESTION_LABELS: Record<ErpAutomationSuggestion["type"], string> = {
  create_requisition: "Create Requisition",
  flag_supplier: "Flag Supplier (Probation)",
  suggest_inspection: "Suggest Inspection",
};

/**
 * Each suggestion type's "accept" routes to a real, existing endpoint —
 * POST /erp/requisitions, POST /suppliers/:id/conditional, POST /audits —
 * never a new write path invented for this panel (see the AI ERP
 * Automation review).
 */
function ErpAutomationPanel() {
  const toast = useToast();
  const canEdit = useCanEditWorkflow("erp");
  const [suggestion, setSuggestion] = useState<AiSuggestion | null>(null);

  const generate = useMutation({
    mutationFn: async () => (await apiClient.post<AiSuggestion>("/erp/ai-automation-suggestions")).data,
    onSuccess: setSuggestion,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't generate suggestions.")),
  });

  const accept = useMutation({
    mutationFn: async (s: ErpAutomationSuggestion) => {
      if (s.type === "create_requisition") return (await apiClient.post("/erp/requisitions", { itemId: s.itemId, quantity: s.quantity ?? 1 })).data;
      if (s.type === "flag_supplier") return (await apiClient.post(`/suppliers/${s.supplierId}/conditional`)).data;
      return (await apiClient.post("/audits", { name: `AI-suggested inspection — ${s.rationale.slice(0, 60)}`, type: "internal" })).data;
    },
    onSuccess: () => toast.success("Action taken."),
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't complete that action.")),
  });

  if (!canEdit) return null;

  const rawOutput = suggestion?.output as { suggestions?: ErpAutomationSuggestion[]; note?: string } | undefined;
  const suggestions = Array.isArray(rawOutput?.suggestions) ? rawOutput!.suggestions! : [];

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">AI ERP Automation</h3>
        <button onClick={() => generate.mutate()} disabled={generate.isPending} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50">
          {generate.isPending ? "Thinking…" : "Suggest Actions"}
        </button>
      </div>
      {suggestion && rawOutput?.note && <p className="mt-3 text-xs text-muted-foreground">{rawOutput.note} No real AI provider key configured for this tenant yet.</p>}
      {suggestions.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {suggestions.map((s, i) => (
            <li key={i} className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
              <div>
                <p className="font-medium">{SUGGESTION_LABELS[s.type]}</p>
                <p className="text-xs text-muted-foreground">{s.rationale}</p>
              </div>
              <button
                onClick={() => accept.mutate(s)}
                disabled={accept.isPending}
                className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                Accept
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Purchase Order roster. Creation needs a dynamic line-item builder the generic quick-create modal can't do, so it's its own page (ErpNewPurchaseOrderPage), not a modal. */
export function ErpPurchaseOrdersPage() {
  const navigate = useNavigate();
  const { data: purchaseOrders = [], isLoading } = poHooks.useList();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Purchase Orders</h1>
          <Link to="/erp/requisitions" className="text-sm text-primary hover:underline">
            View Purchase Requisitions →
          </Link>
        </div>
        <button onClick={() => navigate("/erp/new")} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
          + New Purchase Order
        </button>
      </div>

      <ErpAutomationPanel />

      <DataTable<ErpPurchaseOrder>
        columns={[
          { header: "ID", accessor: (po) => `#${po.id}` },
          { header: "Supplier", accessor: (po) => po.supplierName ?? "—" },
          { header: "Status", accessor: (po) => <StatusBadge value={po.status} /> },
          { header: "Total Value", accessor: (po) => (po.totalValue ? `$${po.totalValue.toFixed(2)}` : "—") },
          // timeZone: "UTC" — expectedDeliveryDate is a real date-only value
          // (stored at exact UTC midnight, see erp.controller.ts), not a
          // moment in time; letting toLocaleDateString convert it to the
          // viewer's local timezone can shift it back a calendar day (e.g.
          // 2026-10-15 rendering as 10/14 for anyone west of UTC).
          { header: "Expected Delivery", accessor: (po) => (po.expectedDeliveryDate ? new Date(po.expectedDeliveryDate).toLocaleDateString(undefined, { timeZone: "UTC" }) : "—") },
          { header: "Created", accessor: (po) => new Date(po.createdAt).toLocaleDateString() },
          { header: "Notes", accessor: (po) => po.notes ?? "—" },
        ]}
        rows={purchaseOrders}
        rowKey={(po) => po.id}
        isLoading={isLoading}
        onRowClick={(po) => navigate(`/erp/${po.id}`)}
        emptyMessage="No purchase orders yet."
      />
    </div>
  );
}
