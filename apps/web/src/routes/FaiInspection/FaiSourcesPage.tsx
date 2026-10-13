import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { faiInspectionApi, type FaiSource } from "../../api/faiInspection";
import type { Supplier } from "../../api/types";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

const STATUS_LABELS: Record<string, string> = {
  not_approved: "Not approved",
  fai_required: "FAI required",
  approved: "Approved",
  suspended: "Suspended",
};

const DUE_BADGE: Record<string, string> = {
  due_soon: "bg-amber-100 text-amber-800",
  overdue: "bg-red-100 text-red-800",
};
const DUE_LABEL: Record<string, string> = {
  due_soon: "Due in 30 days",
  overdue: "Overdue",
};

const EMPTY_FORM = { partNumber: "", supplierId: "", supplierFactory: "", receivingLocation: "", status: "fai_required" };

export function FaiSourcesPage() {
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState(params.get("status") ?? "");
  const [signId, setSignId] = useState<number | null>(null);
  const [pin, setPin] = useState("");
  const [certified, setCertified] = useState(false);
  const [newStatus, setNewStatus] = useState("approved");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { effective } = useEffectivePermissions();
  const canManage = effective?.["fai.sources.manage"] === "edit";
  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["suppliers"], queryFn: async () => (await apiClient.get("/suppliers")).data, enabled: canManage });
  // null = closed, "new" = adding, a number = editing that source.
  const [editing, setEditing] = useState<"new" | number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deleting, setDeleting] = useState<FaiSource | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["fai-inspection", "sources", statusFilter],
    queryFn: () => faiInspectionApi.sources.list(statusFilter || undefined),
  });

  const setStatus = useMutation({
    mutationFn: (body: any) => faiInspectionApi.sources.setStatus(signId!, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fai-inspection", "sources"] });
      setSignId(null); setPin(""); setCertified(false); setReason(""); setError(null);
    },
    onError: (err) => setError(extractErrorMessage(err, "Could not change status.")),
  });

  const afterChange = () => {
    queryClient.invalidateQueries({ queryKey: ["fai-inspection", "sources"] });
    queryClient.invalidateQueries({ queryKey: ["fai-inspection", "dashboard"] });
    setEditing(null); setDeleting(null); setError(null);
  };
  const saveSource = useMutation({
    mutationFn: () => {
      const body = {
        partNumber: form.partNumber.trim(),
        supplierId: form.supplierId ? Number(form.supplierId) : null,
        supplierFactory: form.supplierFactory.trim() || null,
        receivingLocation: form.receivingLocation.trim() || null,
      };
      return editing === "new" ? faiInspectionApi.sources.create({ ...body, status: form.status }) : faiInspectionApi.sources.update(editing as number, body);
    },
    onSuccess: afterChange,
    onError: (err) => setError(extractErrorMessage(err, "Could not save the source.")),
  });
  const removeSource = useMutation({
    mutationFn: () => faiInspectionApi.sources.delete(deleting!.id),
    onSuccess: afterChange,
    onError: (err) => { setDeleting(null); setError(extractErrorMessage(err, "Could not delete the source.")); },
  });
  const supplierLabel = (id?: number | null) => suppliers.find((x) => x.id === id)?.name ?? "";

  let rows = data ?? [];
  const due = params.get("due");
  const today = new Date().toISOString().slice(0, 10);
  if (due === "overdue") rows = rows.filter((r) => r.nextDueDate && r.nextDueDate < today);
  if (due === "30") {
    const in30 = new Date(); in30.setDate(in30.getDate() + 30);
    const in30s = in30.toISOString().slice(0, 10);
    rows = rows.filter((r) => r.nextDueDate && r.nextDueDate >= today && r.nextDueDate <= in30s);
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Approved Sources</h1>
        {canManage && (
          <button onClick={() => { setForm(EMPTY_FORM); setEditing("new"); }} className="rounded bg-primary text-primary-foreground px-4 py-2 hover:opacity-90">Add Source</button>
        )}
      </div>
      <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border rounded px-3 py-2 mb-4">
        <option value="">All statuses</option>
        {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-4">{error}</div>}
      {isLoading ? <div>Loading…</div> : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">Part</th><th className="p-2">Supplier factory</th><th className="p-2">Receiving location</th>
              <th className="p-2">Status</th><th className="p-2">Last FAI</th><th className="p-2">Last result</th>
              <th className="p-2">Next due</th><th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-b hover:bg-gray-50">
                <td className="p-2">{s.partNumber}</td>
                <td className="p-2">{s.supplierFactory ?? ""}</td>
                <td className="p-2">{s.receivingLocation ?? ""}</td>
                <td className="p-2">{STATUS_LABELS[s.status] ?? s.status}</td>
                <td className="p-2">{s.lastFaiDate ?? "—"}</td>
                <td className="p-2">{s.lastResult ?? "—"}</td>
                <td className="p-2">
                  {s.nextDueDate ?? "—"}
                  {s.dueStatus && (
                    <span className={`ml-2 rounded px-2 py-0.5 text-xs font-medium ${DUE_BADGE[s.dueStatus]}`}>{DUE_LABEL[s.dueStatus]}</span>
                  )}
                </td>
                <td className="p-2 whitespace-nowrap">
                  <button onClick={() => { setSignId(s.id); setNewStatus(s.status); }} className="text-blue-600 hover:underline text-sm">
                    Change status…
                  </button>
                  {canManage && (
                    <>
                      <button
                        onClick={() => { setForm({ partNumber: s.partNumber, supplierId: s.supplierId ? String(s.supplierId) : "", supplierFactory: s.supplierFactory ?? "", receivingLocation: s.receivingLocation ?? "", status: s.status }); setEditing(s.id); }}
                        className="ml-3 text-blue-600 hover:underline text-sm"
                      >
                        Edit
                      </button>
                      <button onClick={() => setDeleting(s)} className="ml-3 text-red-700 hover:underline text-sm">Delete</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing !== null && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center">
          <div className="bg-white rounded-lg p-6 w-96">
            <h2 className="text-lg font-semibold mb-4">{editing === "new" ? "Add approved source" : "Edit approved source"}</h2>
            <label className="block mb-3">Part number*
              <input value={form.partNumber} onChange={(e) => setForm({ ...form, partNumber: e.target.value })} className="border rounded px-3 py-2 w-full mt-1" />
            </label>
            <label className="block mb-3">Supplier
              <select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })} className="border rounded px-3 py-2 w-full mt-1">
                <option value="">None</option>
                {suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            <label className="block mb-3">Factory
              <input value={form.supplierFactory} onChange={(e) => setForm({ ...form, supplierFactory: e.target.value })} className="border rounded px-3 py-2 w-full mt-1" />
            </label>
            <label className="block mb-3">Receiving location
              <input value={form.receivingLocation} onChange={(e) => setForm({ ...form, receivingLocation: e.target.value })} className="border rounded px-3 py-2 w-full mt-1" />
            </label>
            {editing === "new" ? (
              <label className="block mb-4">Starting status
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="border rounded px-3 py-2 w-full mt-1">
                  {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
            ) : (
              <p className="text-xs text-gray-500 mb-4">Status changes use "Change status…" so they are signed.</p>
            )}
            <div className="flex gap-3">
              <button onClick={() => saveSource.mutate()} disabled={!form.partNumber.trim() || saveSource.isPending} className="rounded bg-primary text-primary-foreground px-4 py-2 disabled:opacity-50">Save</button>
              <button onClick={() => setEditing(null)} className="rounded border px-4 py-2">Cancel</button>
            </div>
          </div>
        </div>
      )}
      {deleting && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center">
          <div className="bg-white rounded-lg p-6 w-96">
            <h2 className="text-lg font-semibold mb-3">Delete approved source?</h2>
            <p className="text-sm mb-4">This removes part {deleting.partNumber}{supplierLabel(deleting.supplierId) ? ` from ${supplierLabel(deleting.supplierId)}` : ""} from the list. This is audit-logged and cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => removeSource.mutate()} disabled={removeSource.isPending} className="rounded border border-red-300 text-red-700 px-4 py-2 disabled:opacity-50">Delete</button>
              <button onClick={() => setDeleting(null)} className="rounded border px-4 py-2">Cancel</button>
            </div>
          </div>
        </div>
      )}
      {signId && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center">
          <div className="bg-white rounded-lg p-6 w-96">
            <h2 className="text-lg font-semibold mb-4">Change source status (signed)</h2>
            <label className="block mb-3">New status
              <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)} className="border rounded px-3 py-2 w-full mt-1">
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="block mb-3">Reason*
              <input value={reason} onChange={(e) => setReason(e.target.value)} className="border rounded px-3 py-2 w-full mt-1" />
            </label>
            <label className="block mb-4">PIN*
              <input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value)} className="border rounded px-3 py-2 w-full mt-1" />
            </label>
            <label className="flex items-center gap-2 mb-4">
              <input type="checkbox" checked={certified} onChange={(e) => setCertified(e.target.checked)} /> <span className="text-sm">I certify this status change</span>
            </label>
            <div className="flex gap-3">
              <button
                onClick={() => setStatus.mutate({ pin, certified: true, status: newStatus, reason, description: `Manual source status change to ${newStatus}` })}
                disabled={!reason || !certified || pin.length !== 4 || setStatus.isPending}
                className="rounded bg-primary text-primary-foreground px-4 py-2 disabled:opacity-50"
              >
                Sign &amp; change
              </button>
              <button onClick={() => { setSignId(null); setCertified(false); }} className="rounded border px-4 py-2">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
