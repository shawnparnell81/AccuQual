import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { faiInspectionApi } from "../../api/faiInspection";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

const STATUS_LABELS: Record<string, string> = {
  not_approved: "Not approved",
  fai_required: "FAI required",
  approved: "Approved",
  suspended: "Suspended",
};

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
      <h1 className="text-2xl font-semibold mb-4">Approved Sources</h1>
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
                <td className="p-2">{s.nextDueDate ?? "—"}</td>
                <td className="p-2">
                  <button onClick={() => { setSignId(s.id); setNewStatus(s.status); }} className="text-blue-600 hover:underline text-sm">
                    Change status…
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
