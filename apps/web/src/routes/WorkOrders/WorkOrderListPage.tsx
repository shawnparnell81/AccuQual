import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { createResourceHooks } from "../../api/resourceHooks";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useCanEditWorkflow } from "../../hooks/useWorkflowAccess";
import { DataTable } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { Modal } from "../../components/modals/Modal";
import { SelectField, TextField, TextAreaField } from "../../components/forms/Field";
import type { WorkOrder, InventoryItem, AiSuggestion } from "../../api/types";

const woHooks = createResourceHooks<WorkOrder>("work-orders");
const itemHooks = createResourceHooks<InventoryItem>("inventory/items");

function NewWorkOrderModal({ isOpen, onClose, onCreated }: { isOpen: boolean; onClose: () => void; onCreated: (wo: WorkOrder) => void }) {
  const toast = useToast();
  const { data: items = [] } = itemHooks.useList();
  const createWo = woHooks.useCreate();
  const [itemId, setItemId] = useState("");
  const [quantityPlanned, setQuantityPlanned] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <Modal title="New Work Order" isOpen={isOpen} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          createWo.mutate(
            { itemId: Number(itemId), quantityPlanned: Number(quantityPlanned), notes: notes || undefined } as never,
            {
              onSuccess: (created) => {
                toast.success(`Work Order #${created.id} created.`);
                setItemId("");
                setQuantityPlanned("");
                setNotes("");
                onClose();
                onCreated(created);
              },
              onError: (err) => toast.error(extractErrorMessage(err, "Couldn't create work order.")),
            }
          );
        }}
      >
        <SelectField label="Item" required value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">Select an item…</option>
          {items.map((it) => (
            <option key={it.id} value={it.id}>
              {it.sku} {it.description ? `— ${it.description}` : ""}
            </option>
          ))}
        </SelectField>
        <TextField label="Quantity Planned" type="number" min="0" step="any" required value={quantityPlanned} onChange={(e) => setQuantityPlanned(e.target.value)} />
        <TextAreaField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button
          type="submit"
          disabled={!itemId || !quantityPlanned || createWo.isPending}
          className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {createWo.isPending ? "Creating…" : "Create Work Order"}
        </button>
      </form>
    </Modal>
  );
}

/**
 * A single suggestion from the work_order_planning pipeline — rendered
 * defensively since the LLM's output is only ever "strict JSON" by
 * instruction, not by guarantee (see prompts.ts's workOrderPlanPrompt), and
 * the honest no-key stub returns a completely different shape
 * ({note, promptPreview}) that this panel must not choke on.
 */
interface PlanSuggestion {
  itemId: number;
  quantity: number;
  priority: "low" | "medium" | "high";
  rationale: string;
}

function AiPlanPanel({ items }: { items: InventoryItem[] }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [suggestion, setSuggestion] = useState<AiSuggestion | null>(null);
  const createWo = woHooks.useCreate();

  const generate = useMutation({
    mutationFn: async () => (await apiClient.post<AiSuggestion>("/work-orders/ai-plan")).data,
    onSuccess: (res) => setSuggestion(res),
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't generate a plan.")),
  });

  const rawOutput = suggestion?.output as { suggestions?: PlanSuggestion[]; note?: string; raw?: string } | undefined;
  const suggestions = Array.isArray(rawOutput?.suggestions) ? rawOutput!.suggestions! : [];
  const itemById = new Map(items.map((i) => [i.id, i]));

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">AI Work Order Planning</h3>
        <button onClick={() => generate.mutate()} disabled={generate.isPending} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50">
          {generate.isPending ? "Thinking…" : "Suggest Work Orders"}
        </button>
      </div>

      {suggestion && rawOutput?.note && (
        <p className="mt-3 text-xs text-muted-foreground">
          {rawOutput.note} No suggestions to review until a real AI provider key is configured for this company (Admin → Company AI Config).
        </p>
      )}

      {suggestions.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {suggestions.map((s, i) => {
            const item = itemById.get(s.itemId);
            return (
              <li key={i} className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
                <div>
                  <p className="font-medium">
                    {item ? item.sku : `Item #${s.itemId}`} — qty {s.quantity} <span className="text-muted-foreground">({s.priority})</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{s.rationale}</p>
                </div>
                <button
                  onClick={() =>
                    createWo.mutate({ itemId: s.itemId, quantityPlanned: s.quantity } as never, {
                      onSuccess: () => {
                        toast.success("Work order created from suggestion.");
                        queryClient.invalidateQueries({ queryKey: ["work-orders"] });
                      },
                      onError: (err) => toast.error(extractErrorMessage(err, "Couldn't create work order.")),
                    })
                  }
                  disabled={createWo.isPending || !item}
                  className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  Create Work Order
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function WorkOrderListPage() {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [status, setStatus] = useState("");
  const { data: items = [] } = itemHooks.useList();
  const { data: rows = [], isLoading, isError } = woHooks.useList(status ? { status } : undefined);
  const canEdit = useCanEditWorkflow("work_orders");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Work Orders</h1>
        {canEdit && (
          <button onClick={() => setCreateOpen(true)} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
            + New Work Order
          </button>
        )}
      </div>

      {canEdit && <AiPlanPanel items={items} />}

      <div className="grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-4">
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          <option value="planned">Planned</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </SelectField>
      </div>

      <DataTable<WorkOrder>
        columns={[
          { header: "ID", accessor: (wo) => `#${wo.id}` },
          { header: "Item", accessor: (wo) => wo.sku ?? `Item #${wo.itemId}` },
          { header: "Qty Planned", accessor: (wo) => wo.quantityPlanned },
          { header: "Qty Completed", accessor: (wo) => wo.quantityCompleted },
          { header: "Status", accessor: (wo) => <StatusBadge value={wo.status} /> },
          { header: "Due", accessor: (wo) => (wo.dueDate ? new Date(wo.dueDate).toLocaleDateString() : "—") },
        ]}
        rows={rows}
        rowKey={(wo) => wo.id}
        isLoading={isLoading}
        isError={isError}
        onRowClick={(wo) => navigate(`/work-orders/${wo.id}`)}
        emptyMessage="No work orders yet."
      />

      <NewWorkOrderModal isOpen={createOpen} onClose={() => setCreateOpen(false)} onCreated={(created) => navigate(`/work-orders/${created.id}`)} />
    </div>
  );
}
