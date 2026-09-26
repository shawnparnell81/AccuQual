import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import { useCurrentUser } from "../../hooks/useAuth";
import { useWorkflowAction, extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useCanEditWorkflow } from "../../hooks/useWorkflowAccess";
import { useToast } from "../../components/shared/ToastProvider";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { TextField, TextAreaField, SelectField } from "../../components/forms/Field";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { Modal } from "../../components/modals/Modal";
import { CreateCustomerButton } from "../../components/shared/CreateCustomerButton";
import type { SalesAccount, SalesActivity, SalesQuote, SalesContract, SalesActivityType, SalesContractType } from "../../api/types";

const salesAccountHooks = createResourceHooks<SalesAccount>("sales/accounts");

const ACTIVITY_TYPES: SalesActivityType[] = ["call", "meeting", "email", "demo", "follow_up", "note"];
const CONTRACT_TYPES: SalesContractType[] = ["customer", "service", "pricing", "renewal"];

const QUOTE_NEXT: Record<string, { action: string; label: string }[]> = {
  draft: [{ action: "submit", label: "Submit" }],
  submitted: [
    { action: "accept", label: "Accept" },
    { action: "reject", label: "Reject" },
  ],
  accepted: [{ action: "archive", label: "Archive" }],
  rejected: [{ action: "archive", label: "Archive" }],
};

const CONTRACT_NEXT: Record<string, { action: string; label: string }[]> = {
  draft: [{ action: "activate", label: "Activate" }],
  active: [{ action: "expire", label: "Expire" }],
  expired: [{ action: "archive", label: "Archive" }],
};

/**
 * Sales & Marketing — one account's own page: contact/status, the append-only
 * activity log (also the target of every other module's "Link to Sales
 * Account" button — see LinkSalesAccountButton), quotes (draft -> submitted
 * -> accepted|rejected -> archived), contracts (draft -> active -> expired ->
 * archived), AI assistance routed through the shared POST /ai/assistant
 * (context.module = "sales_account" — see ai.assistant.ts), and delete
 * (admin-only, no department at all — see sales.controller.ts's own comment).
 */
export function SalesAccountDetailPage() {
  const { id } = useParams();
  const accountId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();
  const currentUser = useCurrentUser();
  const canEdit = useCanEditWorkflow("sales_accounts");
  const isAdmin = currentUser?.roleName === "admin";

  const { data: account, isLoading, isError } = salesAccountHooks.useOne(accountId);
  const historyKey: unknown[][] = [["workflow-history", "sales_accounts", accountId]];

  const activateAction = useWorkflowAction("sales/accounts", "activate", { successMessage: "Account activated.", invalidateKeys: historyKey });
  const dormantAction = useWorkflowAction("sales/accounts", "mark-dormant", { successMessage: "Account marked dormant.", invalidateKeys: historyKey });

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  const deleteAccount = useMutation({
    mutationFn: async () => apiClient.delete(`/sales/accounts/${accountId}`),
    onSuccess: () => {
      toast.success("Sales account deleted.");
      navigate("/sales");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't delete this account.")),
  });

  if (isError) return <p className="text-sm text-destructive">Couldn't load this record — try refreshing the page.</p>;
  if (isLoading || !account) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold">{account.customerName}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge value={account.status} />
            {account.industry && <span className="text-sm text-muted-foreground">{account.industry}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => window.print()} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Print
          </button>
          <button onClick={() => setAiOpen(true)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            AI Assistant
          </button>
          <CreateCustomerButton sourceType="SalesAccount" sourceId={accountId} defaultLegalName={account.customerName} />
          {canEdit && (
            <button onClick={() => setEditOpen(true)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              Edit
            </button>
          )}
          <WorkflowActionButton
            label="Activate"
            navKey="sales_accounts"
            action={activateAction}
            onClick={() => activateAction.mutate({ id: accountId })}
            visible={account.status === "prospect"}
            variant="primary"
          />
          <WorkflowActionButton
            label="Mark Dormant"
            navKey="sales_accounts"
            action={dormantAction}
            onClick={() => dormantAction.mutate({ id: accountId })}
            visible={account.status === "active"}
          />
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
          <span>Name: <b className="text-foreground">{account.primaryContactName ?? "—"}</b></span>
          <span>Email: <b className="text-foreground">{account.primaryContactEmail ?? "—"}</b></span>
          <span>Phone: <b className="text-foreground">{account.primaryContactPhone ?? "—"}</b></span>
        </div>
      </div>

      <ActivitiesPanel accountId={accountId} activities={account.activities ?? []} />
      <QuotesPanel accountId={accountId} quotes={account.quotes ?? []} />
      <ContractsPanel accountId={accountId} contracts={account.contracts ?? []} />

      <WorkflowHistoryPanel moduleName="sales_accounts" recordId={accountId} />

      <EditAccountModal account={account} isOpen={editOpen} onClose={() => setEditOpen(false)} />
      <SalesAiModal accountId={accountId} isOpen={aiOpen} onClose={() => setAiOpen(false)} />

      <Modal title="Delete Sales Account" isOpen={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <div className="flex flex-col gap-4">
          <p className="text-sm">Permanently delete "{account.customerName}" and all of its activities, quotes, and contracts? This cannot be undone.</p>
          <div className="flex gap-2">
            <button
              onClick={() => deleteAccount.mutate()}
              disabled={deleteAccount.isPending}
              className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-60"
            >
              {deleteAccount.isPending ? "Deleting…" : "Delete permanently"}
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

function EditAccountModal({ account, isOpen, onClose }: { account: SalesAccount; isOpen: boolean; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    customerName: account.customerName,
    industry: account.industry ?? "",
    primaryContactName: account.primaryContactName ?? "",
    primaryContactEmail: account.primaryContactEmail ?? "",
    primaryContactPhone: account.primaryContactPhone ?? "",
  });

  const update = useMutation({
    mutationFn: async () =>
      (
        await apiClient.put(`/sales/accounts/${account.id}`, {
          customerName: form.customerName,
          industry: form.industry || undefined,
          primaryContactName: form.primaryContactName || undefined,
          primaryContactEmail: form.primaryContactEmail || undefined,
          primaryContactPhone: form.primaryContactPhone || undefined,
        })
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales/accounts", account.id] });
      toast.success("Sales account updated.");
      onClose();
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't update this account — Sales & Marketing only.")),
  });

  return (
    <Modal title={`Edit ${account.customerName}`} isOpen={isOpen} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate();
        }}
      >
        <TextField label="Customer name" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} required />
        <TextField label="Industry" value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
        <TextField label="Primary contact name" value={form.primaryContactName} onChange={(e) => setForm({ ...form, primaryContactName: e.target.value })} />
        <TextField label="Primary contact email" type="email" value={form.primaryContactEmail} onChange={(e) => setForm({ ...form, primaryContactEmail: e.target.value })} />
        <TextField label="Primary contact phone" value={form.primaryContactPhone} onChange={(e) => setForm({ ...form, primaryContactPhone: e.target.value })} />
        <button type="submit" disabled={update.isPending} className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {update.isPending ? "Saving…" : "Save"}
        </button>
      </form>
    </Modal>
  );
}

/** The append-only CRM note log — no update/delete, same reasoning as sales.controller.ts's createActivityHandler comment. */
function ActivitiesPanel({ accountId, activities }: { accountId: number; activities: SalesActivity[] }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [activityType, setActivityType] = useState<SalesActivityType>("note");
  const [notes, setNotes] = useState("");
  const [nextSteps, setNextSteps] = useState("");
  const [dueDate, setDueDate] = useState("");

  const addActivity = useMutation({
    mutationFn: async () =>
      apiClient.post(`/sales/accounts/${accountId}/activities`, { activityType, notes: notes || undefined, nextSteps: nextSteps || undefined, dueDate: dueDate || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales/accounts", accountId] });
      setNotes("");
      setNextSteps("");
      setDueDate("");
      toast.success("Activity logged.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't log that activity.")),
  });

  const sorted = [...activities].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-medium">Activity Log</h2>
      {sorted.length === 0 && <p className="mb-3 text-sm text-muted-foreground">No activity logged yet.</p>}
      {sorted.length > 0 && (
        <ul className="mb-4 flex flex-col gap-2 text-sm">
          {sorted.map((a) => (
            <li key={a.id} className="border-b border-border pb-2 last:border-0">
              <div className="flex items-center justify-between">
                <span className="font-medium capitalize">{a.activityType.replace(/_/g, " ")}</span>
                <span className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</span>
              </div>
              {a.notes && <p className="text-muted-foreground">{a.notes}</p>}
              {a.nextSteps && <p className="text-xs text-muted-foreground">Next: {a.nextSteps}{a.dueDate ? ` (due ${a.dueDate})` : ""}</p>}
              {a.relatedSourceType && (
                <p className="text-xs text-muted-foreground">
                  Linked from {a.relatedSourceType} #{a.relatedSourceId}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid gap-3 md:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          addActivity.mutate();
        }}
      >
        <SelectField label="Type" value={activityType} onChange={(e) => setActivityType(e.target.value as SalesActivityType)}>
          {ACTIVITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </SelectField>
        <TextField label="Next steps (optional)" value={nextSteps} onChange={(e) => setNextSteps(e.target.value)} />
        <TextField label="Due date (optional)" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        <button type="submit" disabled={addActivity.isPending} className="self-end rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60">
          Log activity
        </button>
        <div className="md:col-span-4">
          <TextAreaField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>
      </form>
    </div>
  );
}

function QuotesPanel({ accountId, quotes }: { accountId: number; quotes: SalesQuote[] }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [quoteNumber, setQuoteNumber] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["sales/accounts", accountId] });

  const addQuote = useMutation({
    mutationFn: async () => apiClient.post(`/sales/accounts/${accountId}/quotes`, { quoteNumber: quoteNumber || undefined }),
    onSuccess: () => {
      invalidate();
      setQuoteNumber("");
      toast.success("Quote created.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't create that quote.")),
  });

  const transition = useMutation({
    mutationFn: async ({ quoteId, action }: { quoteId: number; action: string }) => apiClient.post(`/sales/accounts/${accountId}/quotes/${quoteId}/${action}`, {}),
    onSuccess: () => {
      invalidate();
      toast.success("Quote updated.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't transition that quote.")),
  });

  const sorted = [...quotes].sort((a, b) => b.id - a.id);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-medium">Quotes</h2>
      {sorted.length === 0 && <p className="mb-3 text-sm text-muted-foreground">No quotes yet.</p>}
      {sorted.length > 0 && (
        <table className="mb-4 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-2 pr-3">Quote #</th>
              <th className="pb-2 pr-3">Rev</th>
              <th className="pb-2 pr-3">Status</th>
              <th className="pb-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((q) => (
              <tr key={q.id} className="border-t border-border">
                <td className="py-1.5 pr-3">{q.quoteNumber}</td>
                <td className="py-1.5 pr-3">{q.revision}</td>
                <td className="py-1.5 pr-3">
                  <StatusBadge value={q.status} />
                </td>
                <td className="py-1.5">
                  <div className="flex gap-1.5">
                    {(QUOTE_NEXT[q.status] ?? []).map((n) => (
                      <button
                        key={n.action}
                        onClick={() => transition.mutate({ quoteId: q.id, action: n.action })}
                        disabled={transition.isPending}
                        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-60"
                      >
                        {n.label}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          addQuote.mutate();
        }}
      >
        <input
          value={quoteNumber}
          onChange={(e) => setQuoteNumber(e.target.value)}
          placeholder="Quote # (optional — auto-generated if blank)"
          className="w-72 rounded-md border border-border bg-transparent px-2 py-1.5 text-sm"
        />
        <button type="submit" disabled={addQuote.isPending} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60">
          + New quote
        </button>
      </form>
    </div>
  );
}

function ContractsPanel({ accountId, contracts }: { accountId: number; contracts: SalesContract[] }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [contractType, setContractType] = useState<SalesContractType>("customer");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [expirationDate, setExpirationDate] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["sales/accounts", accountId] });

  const addContract = useMutation({
    mutationFn: async () =>
      apiClient.post(`/sales/accounts/${accountId}/contracts`, { contractType, effectiveDate: effectiveDate || undefined, expirationDate: expirationDate || undefined }),
    onSuccess: () => {
      invalidate();
      setEffectiveDate("");
      setExpirationDate("");
      toast.success("Contract created.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't create that contract.")),
  });

  const transition = useMutation({
    mutationFn: async ({ contractId, action }: { contractId: number; action: string }) => apiClient.post(`/sales/accounts/${accountId}/contracts/${contractId}/${action}`, {}),
    onSuccess: () => {
      invalidate();
      toast.success("Contract updated.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't transition that contract.")),
  });

  const sorted = [...contracts].sort((a, b) => b.id - a.id);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-medium">Contracts</h2>
      {sorted.length === 0 && <p className="mb-3 text-sm text-muted-foreground">No contracts yet.</p>}
      {sorted.length > 0 && (
        <table className="mb-4 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-2 pr-3">Type</th>
              <th className="pb-2 pr-3">Effective</th>
              <th className="pb-2 pr-3">Expires</th>
              <th className="pb-2 pr-3">Status</th>
              <th className="pb-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="py-1.5 pr-3 capitalize">{c.contractType}</td>
                <td className="py-1.5 pr-3">{c.effectiveDate ?? "—"}</td>
                <td className="py-1.5 pr-3">{c.expirationDate ?? "—"}</td>
                <td className="py-1.5 pr-3">
                  <StatusBadge value={c.status} />
                </td>
                <td className="py-1.5">
                  <div className="flex gap-1.5">
                    {(CONTRACT_NEXT[c.status] ?? []).map((n) => (
                      <button
                        key={n.action}
                        onClick={() => transition.mutate({ contractId: c.id, action: n.action })}
                        disabled={transition.isPending}
                        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-60"
                      >
                        {n.label}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form
        className="grid gap-3 md:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          addContract.mutate();
        }}
      >
        <SelectField label="Type" value={contractType} onChange={(e) => setContractType(e.target.value as SalesContractType)}>
          {CONTRACT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </SelectField>
        <TextField label="Effective date (optional)" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
        <TextField label="Expiration date (optional)" type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} />
        <button type="submit" disabled={addContract.isPending} className="self-end rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60">
          + New contract
        </button>
      </form>
    </div>
  );
}

interface ParsedSuggestion {
  nextSteps?: string;
  summary?: string;
}

/**
 * AI Assistant — routed through the shared POST /ai/assistant
 * (context.module = "sales_account"), per the module's own locked "ALL AI
 * calls MUST route through /ai/assistant" rule — same pattern as
 * FeasibilityAiModal.
 */
function SalesAiModal({ accountId, isOpen, onClose }: { accountId: number; isOpen: boolean; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState(
    "Summarize this account's recent activity and open quotes/contracts, and suggest the most useful next step. " +
      'Respond as strict JSON only: { "summary": string, "nextSteps": string }'
  );
  const [raw, setRaw] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedSuggestion | null>(null);

  const generate = useMutation({
    mutationFn: async () =>
      (await apiClient.post("/ai/assistant", { messages: [{ role: "user", content: prompt }], context: { module: "sales_account", recordId: accountId } })).data as { content: string },
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

  const applyNote = useMutation({
    mutationFn: async (text: string) => apiClient.post(`/sales/accounts/${accountId}/activities`, { activityType: "note", notes: text }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales/accounts", accountId] });
      toast.success("Logged as an activity note.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't log that note.")),
  });

  return (
    <Modal title="AI Assistant" isOpen={isOpen} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">Routed through the same assistant every module uses — it only ever suggests text. Nothing is saved until you click Apply below.</p>
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
                <div className="mb-1 flex items-center justify-between">
                  <h4 className="text-xs font-medium text-muted-foreground">Suggested next steps</h4>
                  <button onClick={() => applyNote.mutate(parsed.nextSteps!)} disabled={applyNote.isPending} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                    Log as activity
                  </button>
                </div>
                <p className="text-sm">{parsed.nextSteps}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
