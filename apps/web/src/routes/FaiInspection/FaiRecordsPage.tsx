import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useOpenTab } from "../../hooks/useOpenTab";
import { faiInspectionApi } from "../../api/faiInspection";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  in_inspection: "In inspection",
  awaiting_signoff: "Awaiting sign-off",
  passed: "Passed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function FaiRecordsPage() {
  const openTab = useOpenTab();
  const [params] = useSearchParams();
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["fai-inspection", "records", status, q],
    queryFn: () => faiInspectionApi.records.list({ status: status || undefined, q: q || undefined }),
  });

  // Phase 3 dashboard-chart drill-down: same client-side query-param filtering convention as FaiSourcesPage's ?due=.
  let rows = data ?? [];
  const trigger = params.get("trigger");
  if (trigger) rows = rows.filter((r) => (r.triggerReason ?? "Not specified") === trigger);
  const agingBucket = params.get("agingBucket");
  if (agingBucket) {
    rows = rows.filter((r) => {
      if (!["draft", "in_inspection", "awaiting_signoff"].includes(r.status) || !r.createdAt) return false;
      const days = Math.floor((Date.now() - new Date(r.createdAt).getTime()) / 86_400_000);
      if (agingBucket === "0-7") return days <= 7;
      if (agingBucket === "8-30") return days > 7 && days <= 30;
      if (agingBucket === "31-60") return days > 30 && days <= 60;
      return days > 60;
    });
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">FAI Records</h1>
        <button
          onClick={() => openTab({ path: "/fai-inspection/records/new", title: "New FAI Record", icon: "clipboard-check" })}
          className="rounded bg-primary text-primary-foreground px-4 py-2 hover:opacity-90"
        >
          New FAI Record
        </button>
      </div>
      <div className="flex gap-3 mb-4">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="border rounded px-3 py-2">
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search FAI number or part…" className="border rounded px-3 py-2 w-80" />
      </div>
      {isLoading ? <div>Loading…</div> : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">FAI number</th><th className="p-2">Part</th><th className="p-2">Trigger</th>
              <th className="p-2">Status</th><th className="p-2">Overall</th><th className="p-2">Inspected</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="p-4 text-gray-500">No FAI records yet. Use New FAI Record to add one.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b hover:bg-gray-50">
                <td className="p-2">
                  <button className="text-blue-600 hover:underline"
                    onClick={() => openTab({ path: `/fai-inspection/records/${r.id}`, title: `FAI ${r.faiNumber}`, icon: "clipboard-check" })}>
                    {r.faiNumber}
                  </button>
                </td>
                <td className="p-2">{r.partNumber}</td>
                <td className="p-2">{r.triggerReason ?? ""}</td>
                <td className="p-2">{STATUS_LABELS[r.status] ?? r.status}</td>
                <td className="p-2">{r.overallResult ?? ""}</td>
                <td className="p-2">{r.dateInspected ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
