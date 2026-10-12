import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOpenTab } from "../../hooks/useOpenTab";
import { faiInspectionApi } from "../../api/faiInspection";

export function FaiPlansPage() {
  const openTab = useOpenTab();
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["fai-inspection", "plans", q],
    queryFn: () => faiInspectionApi.plans.list(q || undefined),
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Inspection Plans</h1>
        <button
          onClick={() => openTab({ path: "/fai-inspection/plans/new", title: "New Inspection Plan", icon: "clipboard-check" })}
          className="rounded bg-primary text-primary-foreground px-4 py-2 hover:opacity-90"
        >
          New Plan
        </button>
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search part number or description…"
        className="border rounded px-3 py-2 mb-4 w-80"
      />
      {isLoading ? (
        <div>Loading…</div>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">Part number</th>
              <th className="p-2">Description</th>
              <th className="p-2">Risk class</th>
              <th className="p-2">Rev</th>
              <th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((p) => (
              <tr key={p.id} className="border-b hover:bg-gray-50">
                <td className="p-2">
                  <button
                    className="text-blue-600 hover:underline"
                    onClick={() => openTab({ path: `/fai-inspection/plans/${p.id}`, title: `Plan ${p.partNumber} rev ${p.revision}`, icon: "clipboard-check" })}
                  >
                    {p.partNumber}
                  </button>
                </td>
                <td className="p-2">{p.partDescription ?? ""}</td>
                <td className="p-2">{p.riskClass}</td>
                <td className="p-2">{p.revision}</td>
                <td className="p-2">{p.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
