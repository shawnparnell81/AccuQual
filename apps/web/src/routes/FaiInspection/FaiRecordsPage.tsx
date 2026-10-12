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
            {(data ?? []).map((r) => (
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
