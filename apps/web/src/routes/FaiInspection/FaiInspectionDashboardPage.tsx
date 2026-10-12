import { useQuery } from "@tanstack/react-query";
import { useOpenTab } from "../../hooks/useOpenTab";
import { faiInspectionApi } from "../../api/faiInspection";

interface Tile {
  key: string;
  label: string;
  count: number;
  listPath: string;
  title: (n: number) => string;
}

export function FaiInspectionDashboardPage() {
  const openTab = useOpenTab();
  const { data, isLoading } = useQuery({
    queryKey: ["fai-inspection", "dashboard"],
    queryFn: () => faiInspectionApi.dashboard(),
  });

  const tiles: Tile[] = [
    { key: "open", label: "Open FAIs", count: data?.open ?? 0, listPath: "/fai-inspection/records?status=draft", title: (n) => `Open FAIs (${n})` },
    { key: "awaiting", label: "Awaiting sign-off", count: data?.awaitingSignoff ?? 0, listPath: "/fai-inspection/records?status=awaiting_signoff", title: (n) => `FAIs Awaiting Sign-off (${n})` },
    { key: "failed90", label: "Failed (last 90 days)", count: data?.failed90 ?? 0, listPath: "/fai-inspection/records?status=failed", title: (n) => `Failed FAIs — Last 90 Days (${n})` },
    { key: "due30", label: "Due in 30 days", count: data?.due30 ?? 0, listPath: "/fai-inspection/sources?due=30", title: (n) => `FAI Due in 30 Days (${n})` },
    { key: "overdue", label: "Overdue", count: data?.overdue ?? 0, listPath: "/fai-inspection/sources?due=overdue", title: (n) => `Overdue FAI Sources (${n})` },
    { key: "notApproved", label: "Not approved sources", count: data?.notApproved ?? 0, listPath: "/fai-inspection/sources?status=not_approved", title: (n) => `Not Approved Sources (${n})` },
  ];

  async function openTile(tile: Tile) {
    if (tile.count === 0) return;
    if (tile.count === 1) {
      // Fetch the single record and open it directly.
      const isRecord = tile.listPath.includes("/records");
      try {
        if (isRecord) {
          const status = new URLSearchParams(tile.listPath.split("?")[1]).get("status") ?? undefined;
          const rows = await faiInspectionApi.records.list({ status });
          const only = rows[0];
          if (only) {
            openTab({ path: `/fai-inspection/records/${only.id}`, title: `${only.faiNumber}`, icon: "clipboard-check" });
            return;
          }
        } else {
          const rows = await faiInspectionApi.sources.list();
          const only = rows[0];
          if (only) {
            openTab({ path: `/fai-inspection/sources`, title: tile.title(1), icon: "clipboard-check" });
            return;
          }
        }
      } catch {
        // fall through to list
      }
    }
    openTab({ path: tile.listPath, title: tile.title(tile.count), icon: "clipboard-check" });
  }

  if (isLoading) return <div className="p-6">Loading…</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-6">FAI &amp; Inspection</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {tiles.map((t) => (
          <button
            key={t.key}
            onClick={() => openTile(t)}
            className="rounded-lg border p-6 text-left hover:border-blue-500 hover:shadow transition"
          >
            <div className="text-4xl font-bold">{t.count}</div>
            <div className="text-sm text-gray-600 mt-1">{t.label}</div>
          </button>
        ))}
      </div>
      <div className="mt-8 flex gap-4">
        <button
          onClick={() => openTab({ path: "/fai-inspection/plans", title: "Inspection Plans", icon: "clipboard-check" })}
          className="rounded border px-4 py-2 hover:bg-gray-50"
        >
          Inspection Plans
        </button>
        <button
          onClick={() => openTab({ path: "/fai-inspection/sources", title: "Approved Sources", icon: "clipboard-check" })}
          className="rounded border px-4 py-2 hover:bg-gray-50"
        >
          Approved Sources
        </button>
        <button
          onClick={() => openTab({ path: "/fai-inspection/records", title: "FAI Records", icon: "clipboard-check" })}
          className="rounded border px-4 py-2 hover:bg-gray-50"
        >
          FAI Records
        </button>
      </div>
    </div>
  );
}
