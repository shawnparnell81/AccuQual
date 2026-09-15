import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { FeasibilityReview } from "../../api/types";
import { StatusBadge } from "../../components/tables/StatusBadge";

const feasibilityHooks = createResourceHooks<FeasibilityReview>("feasibility");

/** Feasibility distribution by decision, average score, open reviews by status, and the not-feasible/low-score worklist. */
export function FeasibilityDashboardPage() {
  const navigate = useNavigate();
  const { data: reviews = [], isLoading } = feasibilityHooks.useList();

  const byDecision = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of reviews) counts.set(r.decision ?? "not yet scored", (counts.get(r.decision ?? "not yet scored") ?? 0) + 1);
    return [...counts.entries()];
  }, [reviews]);

  const byStatus = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of reviews) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    return [...counts.entries()];
  }, [reviews]);

  const scored = reviews.filter((r) => r.overallScore !== null);
  const avgScore = scored.length > 0 ? scored.reduce((sum, r) => sum + Number(r.overallScore), 0) / scored.length : null;

  const highRisk = reviews.filter((r) => r.decision === "not_feasible" || r.decision === "conditional");

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Feasibility Dashboard</h1>
          <p className="text-sm text-muted-foreground">Across every source type — NCR, Supplier, Complaints, PPAP, Change Mgmt, Work Orders, Requisitions, PO, RMA.</p>
        </div>
        <button onClick={() => navigate("/feasibility")} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
          Back to list
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-1 text-sm font-medium">Average Overall Score</h2>
          <p className="text-3xl font-semibold tabular-nums">{avgScore !== null ? avgScore.toFixed(2) : "—"}</p>
          <p className="text-xs text-muted-foreground">{scored.length} of {reviews.length} review(s) scored</p>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-medium">By Decision</h2>
          <ul className="flex flex-col gap-1.5 text-sm">
            {byDecision.map(([d, count]) => (
              <li key={d} className="flex items-center justify-between">
                <span className="capitalize">{d.replace(/_/g, " ")}</span>
                <span className="font-semibold">{count}</span>
              </li>
            ))}
            {byDecision.length === 0 && <li className="text-muted-foreground">No reviews yet.</li>}
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
            {byStatus.length === 0 && <li className="text-muted-foreground">No reviews yet.</li>}
          </ul>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">Conditional / Not Feasible</h2>
        {highRisk.length === 0 ? (
          <p className="text-sm text-muted-foreground">None right now.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {highRisk.map((r) => (
              <li key={r.id} className="flex items-center justify-between border-b border-border pb-1.5 last:border-0">
                <button onClick={() => navigate(`/feasibility/${r.id}`)} className="text-left hover:text-primary">
                  #{r.id} — {r.title}
                </button>
                <div className="flex items-center gap-2">
                  {r.decision && <StatusBadge value={r.decision} />}
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
