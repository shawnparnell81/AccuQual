import { Fragment, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { RiskAssessment } from "../../api/types";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { riskLevelFromScore } from "../../components/shared/riskConstants";

const riskHooks = createResourceHooks<RiskAssessment>("risk");

const LEVEL_BG: Record<string, string> = {
  low: "bg-muted",
  medium: "bg-warning/25",
  high: "bg-warning/60",
  critical: "bg-destructive/70",
};

/**
 * Risk Dashboard — heatmap (severity x probability), category/status
 * distribution, and the high/critical worklist. Deliberately its own page
 * rather than a widget bolted onto RiskPage — the module's own requirement
 * calls it out as a distinct deliverable, and it's the one place someone
 * scans across every open risk instead of one at a time.
 */
export function RiskDashboardPage() {
  const navigate = useNavigate();
  const { data: risks = [], isLoading } = riskHooks.useList();

  const heatmap = useMemo(() => {
    const grid: number[][] = Array.from({ length: 5 }, () => Array(5).fill(0));
    for (const r of risks) {
      if (r.severity && r.probability) grid[r.severity - 1]![r.probability - 1]! += 1;
    }
    return grid;
  }, [risks]);

  const byCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of risks) counts.set(r.category ?? "uncategorized", (counts.get(r.category ?? "uncategorized") ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [risks]);

  const byStatus = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of risks) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    return [...counts.entries()];
  }, [risks]);

  const highCritical = risks.filter((r) => r.riskLevel === "high" || r.riskLevel === "critical" || (r.riskScore && r.riskScore >= 10));

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Risk Dashboard</h1>
          <p className="text-sm text-muted-foreground">The Risk Register only — not the AI Insights supplier-risk score or the Digital Twin's simulation heatmap.</p>
        </div>
        <button onClick={() => navigate("/risk")} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
          Back to list
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-medium">Heatmap — Severity x Probability</h2>
          <div className="inline-grid grid-cols-[auto_repeat(5,2.75rem)] gap-1 text-xs">
            <div />
            {[1, 2, 3, 4, 5].map((p) => (
              <div key={p} className="text-center text-muted-foreground">
                P{p}
              </div>
            ))}
            {[5, 4, 3, 2, 1].map((sev) => (
              <Fragment key={sev}>
                <div className="flex items-center pr-1 text-muted-foreground">S{sev}</div>
                {[1, 2, 3, 4, 5].map((prob) => {
                  const count = heatmap[sev - 1]![prob - 1]!;
                  const level = riskLevelFromScore(sev * prob);
                  return (
                    <div key={`${sev}-${prob}`} className={`flex h-11 w-11 items-center justify-center rounded-md font-semibold ${LEVEL_BG[level]}`}>
                      {count > 0 ? count : ""}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-medium">By Category</h2>
            <ul className="flex flex-col gap-1.5 text-sm">
              {byCategory.map(([cat, count]) => (
                <li key={cat} className="flex items-center justify-between">
                  <span className="capitalize">{cat}</span>
                  <span className="font-semibold">{count}</span>
                </li>
              ))}
              {byCategory.length === 0 && <li className="text-muted-foreground">No risks yet.</li>}
            </ul>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-medium">By Status</h2>
            <ul className="flex flex-col gap-1.5 text-sm">
              {byStatus.map(([status, count]) => (
                <li key={status} className="flex items-center justify-between">
                  <StatusBadge value={status} />
                  <span className="font-semibold">{count}</span>
                </li>
              ))}
              {byStatus.length === 0 && <li className="text-muted-foreground">No risks yet.</li>}
            </ul>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">High / Critical Risks</h2>
        {highCritical.length === 0 ? (
          <p className="text-sm text-muted-foreground">None right now.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {highCritical.map((r) => (
              <li key={r.id} className="flex items-center justify-between border-b border-border pb-1.5 last:border-0">
                <button onClick={() => navigate(`/risk/${r.id}`)} className="text-left hover:text-primary">
                  #{r.id} — {r.title}
                </button>
                <div className="flex items-center gap-2">
                  {r.riskLevel && <StatusBadge value={r.riskLevel} />}
                  <StatusBadge value={r.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
