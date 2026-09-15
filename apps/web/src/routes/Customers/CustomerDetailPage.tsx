import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import { useCurrentUser } from "../../hooks/useAuth";
import { useWorkflowAction, extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useCanEditWorkflow } from "../../hooks/useWorkflowAccess";
import { useSetAssistantContext } from "../../hooks/useAssistantContext";
import { useToast } from "../../components/shared/ToastProvider";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { TextField, TextAreaField, SelectField } from "../../components/forms/Field";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { CreateRiskButton } from "../../components/shared/CreateRiskButton";
import { CreateFeasibilityButton } from "../../components/shared/CreateFeasibilityButton";
import { Modal } from "../../components/modals/Modal";
import type { Customer, CustomerType } from "../../api/types";

const customerHooks = createResourceHooks<Customer>("customers");
const CUSTOMER_TYPES: CustomerType[] = ["OEM", "Tier 1", "Tier 2", "Distributor", "Other"];

const NEXT_ACTION: Record<string, { action: string; label: string }> = {
  draft: { action: "submit", label: "Submit" },
  submitted: { action: "review", label: "Move to Under Review" },
  approved: { action: "activate", label: "Activate" },
};

const RELATED_SOURCE_LINK: Record<string, (id: number) => string> = {
  NCR: (id) => `/ncr/${id}`,
  Supplier: (id) => `/suppliers/${id}`,
  WorkOrder: (id) => `/work-orders/${id}`,
  Requisition: (id) => `/erp/requisitions/${id}`,
  PO: (id) => `/erp/${id}`,
  RMA: (id) => `/rma/${id}`,
  Risk: (id) => `/risk/${id}`,
  Feasibility: (id) => `/feasibility/${id}`,
  SalesAccount: (id) => `/sales/${id}`,
};

/**
 * Customer Onboarding detail — the module's own record page: edit, workflow
 * transitions (draft -> submitted -> under_review -> approved -> activated,
 * or -> rejected from under_review), the 5-section Customer Requirements
 * form (customer_requirements, opened as a real fillable document — see
 * customerRequirements.ts), an NDA link into Document Control, "Create Risk"
 * / "Feasibility Review" (this record is now a real sourceType on both — see
 * risk.validation.ts/feasibility.validation.ts), AI analysis routed through
 * the shared POST /ai/assistant, and admin-only delete.
 */
export function CustomerDetailPage() {
  const { id } = useParams();
  const customerId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();
  const currentUser = useCurrentUser();
  const canEdit = useCanEditWorkflow("customers");
  const isAdmin = currentUser?.roleName === "admin" || currentUser?.roleName === "platform_admin";

  const { data: customer, isLoading } = customerHooks.useOne(customerId);
  useSetAssistantContext("customer", customerId, customer ? customer.legalName : `Customer #${customerId}`);
  const historyKey: unknown[][] = [["workflow-history", "customers", customerId]];

  const submitAction = useWorkflowAction("customers", "submit", { successMessage: "Submitted.", invalidateKeys: historyKey });
  const reviewAction = useWorkflowAction("customers", "review", { successMessage: "Moved to under review.", invalidateKeys: historyKey });
  const approveAction = useWorkflowAction("customers", "approve", { successMessage: "Approved.", invalidateKeys: historyKey });
  const rejectAction = useWorkflowAction("customers", "reject", { successMessage: "Rejected.", invalidateKeys: historyKey });
  const activateAction = useWorkflowAction("customers", "activate", { successMessage: "Activated.", invalidateKeys: historyKey });

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  const deleteCustomer = useMutation({
    mutationFn: async () => apiClient.delete(`/customers/${customerId}`),
    onSuccess: () => {
      toast.success("Customer onboarding case deleted.");
      navigate("/customers");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't delete this case.")),
  });

  if (isLoading || !customer) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const ACTION_MAP: Record<string, typeof submitAction> = { submit: submitAction, review: reviewAction, activate: activateAction };
  const next = NEXT_ACTION[customer.status];
  const sourceLink = customer.relatedSourceType && customer.relatedSourceId ? RELATED_SOURCE_LINK[customer.relatedSourceType]?.(customer.relatedSourceId) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">
            {customer.legalName}
            {customer.dbaName ? ` (dba ${customer.dbaName})` : ""}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge value={customer.status} />
            {customer.customerType && <span className="text-sm text-muted-foreground">{customer.customerType}</span>}
            {customer.industry && <span className="text-sm text-muted-foreground">— {customer.industry}</span>}
            {sourceLink && (
              <a href={sourceLink} className="text-sm text-primary hover:underline">
                Started from {customer.relatedSourceType} #{customer.relatedSourceId}
              </a>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <OpenFormButton formType="customer_requirements" entityId={customer.id} title={`Customer Requirements — ${customer.legalName}`} label="Customer Requirements" />
          <button onClick={() => setAiOpen(true)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            AI Assistant
          </button>
          <CreateRiskButton sourceType="Customer" sourceId={customer.id} defaultTitle={`Risk from ${customer.legalName}`} defaultDepartment="sales_and_marketing" defaultCategory="other" />
          <CreateFeasibilityButton customerId={customer.id} customerName={customer.legalName} />
          {canEdit && (
            <button onClick={() => setEditOpen(true)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              Edit
            </button>
          )}
          {next && (
            <WorkflowActionButton
              label={next.label}
              navKey="customers"
              action={ACTION_MAP[next.action]!}
              onClick={() => ACTION_MAP[next.action]!.mutate({ id: customerId })}
              variant="primary"
            />
          )}
          <WorkflowActionButton label="Approve" navKey="customers" action={approveAction} onClick={() => approveAction.mutate({ id: customerId })} visible={customer.status === "under_review"} variant="primary" />
          <WorkflowActionButton label="Reject" navKey="customers" action={rejectAction} onClick={() => rejectAction.mutate({ id: customerId })} visible={customer.status === "under_review"} />
          {isAdmin && (
            <button onClick={() => setDeleteOpen(true)} className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive hover:bg-destructive/10">
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-medium">Contact</h2>
        <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
          <span>Name: <b className="text-foreground">{customer.primaryContactName ?? "—"}</b></span>
          <span>Email: <b className="text-foreground">{customer.primaryContactEmail ?? "—"}</b></span>
          <span>Phone: <b className="text-foreground">{customer.primaryContactPhone ?? "—"}</b></span>
        </div>
        <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <span>Address: <b className="text-foreground">{customer.address ?? "—"}</b></span>
          <span>Billing Address: <b className="text-foreground">{customer.billingAddress ?? "—"}</b></span>
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <span>NDA:</span>
          {customer.ndaDocumentId ? (
            <a href={`/documents/${customer.ndaDocumentId}`} className="text-primary hover:underline">
              Document #{customer.ndaDocumentId}
            </a>
          ) : (
            <span>not on file — set from Edit, linking to a real Document Control record</span>
          )}
        </div>
      </div>

      <WorkflowHistoryPanel moduleName="customers" recordId={customerId} />

      <EditCustomerModal customer={customer} isOpen={editOpen} onClose={() => setEditOpen(false)} />
      <CustomerAiModal customerId={customerId} isOpen={aiOpen} onClose={() => setAiOpen(false)} />

      <Modal title="Delete Customer Onboarding Case" isOpen={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <div className="flex flex-col gap-4">
          <p className="text-sm">Permanently delete "{customer.legalName}"? This cannot be undone.</p>
          <div className="flex gap-2">
            <button
              onClick={() => deleteCustomer.mutate()}
              disabled={deleteCustomer.isPending}
              className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-60"
            >
              {deleteCustomer.isPending ? "Deleting…" : "Delete permanently"}
            </button>
            <button onClick={() => setDeleteOpen(false)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function EditCustomerModal({ customer, isOpen, onClose }: { customer: Customer; isOpen: boolean; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    legalName: customer.legalName,
    dbaName: customer.dbaName ?? "",
    address: customer.address ?? "",
    billingAddress: customer.billingAddress ?? "",
    website: customer.website ?? "",
    primaryContactName: customer.primaryContactName ?? "",
    primaryContactEmail: customer.primaryContactEmail ?? "",
    primaryContactPhone: customer.primaryContactPhone ?? "",
    industry: customer.industry ?? "",
    customerType: customer.customerType ?? "",
    ndaDocumentId: customer.ndaDocumentId?.toString() ?? "",
  });

  const update = useMutation({
    mutationFn: async () =>
      (
        await apiClient.put(`/customers/${customer.id}`, {
          legalName: form.legalName,
          dbaName: form.dbaName || undefined,
          address: form.address || undefined,
          billingAddress: form.billingAddress || undefined,
          website: form.website || undefined,
          primaryContactName: form.primaryContactName || undefined,
          primaryContactEmail: form.primaryContactEmail || undefined,
          primaryContactPhone: form.primaryContactPhone || undefined,
          industry: form.industry || undefined,
          customerType: form.customerType || undefined,
          ndaDocumentId: form.ndaDocumentId ? Number(form.ndaDocumentId) : null,
        })
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers", customer.id] });
      toast.success("Customer updated.");
      onClose();
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't update this case — Sales & Marketing only.")),
  });

  return (
    <Modal title={`Edit ${customer.legalName}`} isOpen={isOpen} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate();
        }}
      >
        <TextField label="Legal name" value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} required />
        <TextField label="DBA name" value={form.dbaName} onChange={(e) => setForm({ ...form, dbaName: e.target.value })} />
        <SelectField label="Customer type" value={form.customerType} onChange={(e) => setForm({ ...form, customerType: e.target.value })}>
          <option value="">Select…</option>
          {CUSTOMER_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </SelectField>
        <TextField label="Industry" value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
        <TextField label="Website" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
        <TextField label="Primary contact name" value={form.primaryContactName} onChange={(e) => setForm({ ...form, primaryContactName: e.target.value })} />
        <TextField label="Primary contact email" type="email" value={form.primaryContactEmail} onChange={(e) => setForm({ ...form, primaryContactEmail: e.target.value })} />
        <TextField label="Primary contact phone" value={form.primaryContactPhone} onChange={(e) => setForm({ ...form, primaryContactPhone: e.target.value })} />
        <TextAreaField label="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} />
        <TextAreaField label="Billing address" value={form.billingAddress} onChange={(e) => setForm({ ...form, billingAddress: e.target.value })} rows={2} />
        <TextField
          label="NDA Document ID (optional)"
          type="number"
          value={form.ndaDocumentId}
          onChange={(e) => setForm({ ...form, ndaDocumentId: e.target.value })}
          placeholder="An existing Document Control record's ID"
        />
        <button type="submit" disabled={update.isPending} className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {update.isPending ? "Saving…" : "Save"}
        </button>
      </form>
    </Modal>
  );
}

interface ParsedSuggestion {
  summary?: string;
  nextSteps?: string;
}

/** AI Assistant — routed through the shared POST /ai/assistant (context.module = "customer"), same pattern as Feasibility/Sales. */
function CustomerAiModal({ customerId, isOpen, onClose }: { customerId: number; isOpen: boolean; onClose: () => void }) {
  const toast = useToast();
  const [prompt, setPrompt] = useState(
    "Summarize this customer onboarding case's current state and suggest the most useful next step. " + 'Respond as strict JSON only: { "summary": string, "nextSteps": string }'
  );
  const [raw, setRaw] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedSuggestion | null>(null);

  const generate = useMutation({
    mutationFn: async () =>
      (await apiClient.post("/ai/assistant", { messages: [{ role: "user", content: prompt }], context: { module: "customer", recordId: customerId } })).data as { content: string },
    onSuccess: (data) => {
      setRaw(data.content);
      try {
        setParsed(JSON.parse(data.content));
      } catch {
        setParsed(null);
      }
    },
    onError: (err) => toast.error(extractErrorMessage(err, "The assistant couldn't respond.")),
  });

  return (
    <Modal title="AI Assistant" isOpen={isOpen} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">Routed through the same assistant every module uses — it only ever suggests text.</p>
        <TextAreaField label="Prompt (edit before generating)" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} />
        <button onClick={() => generate.mutate()} disabled={generate.isPending} className="w-fit rounded-md bg-button px-3 py-1.5 text-sm text-button-foreground disabled:opacity-60">
          {generate.isPending ? "Generating…" : "Generate"}
        </button>
        {raw && !parsed && (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
            <p className="mb-1 text-muted-foreground">Couldn't parse a structured suggestion — raw response:</p>
            <pre className="whitespace-pre-wrap">{raw}</pre>
          </div>
        )}
        {parsed && (
          <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-3">
            {parsed.summary && <p className="text-sm">{parsed.summary}</p>}
            {parsed.nextSteps && (
              <div>
                <h4 className="mb-1 text-xs font-medium text-muted-foreground">Suggested next steps</h4>
                <p className="text-sm">{parsed.nextSteps}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
