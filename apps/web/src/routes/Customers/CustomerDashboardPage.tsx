import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { Customer } from "../../api/types";
import { StatusBadge } from "../../components/tables/StatusBadge";

const customerHooks = createResourceHooks<Customer>("customers");

/** Customer Onboarding pipeline: counts by status, and a worklist of cases waiting on a decision. */
export function CustomerDashboardPage() {
  const navigate = useNavigate();
  const { data: customersList = [], isLoading } = customerHooks.useList();

  const byStatus = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of customersList) counts.set(c.status, (counts.get(c.status) ?? 0) + 1);
    return [...counts.entries()];
  }, [customersList]);

  const awaitingDecision = customersList.filter((c) => c.status === "submitted" || c.status === "under_review");
  const activated = customersList.filter((c) => c.status === "activated");

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Customer Onboarding Dashboard</h1>
          <p className="text-sm text-muted-foreground">Qualification pipeline across every new and existing customer case.</p>
        </div>
        <button onClick={() => navigate("/customers")} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
          Back to list
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-1 text-sm font-medium">Total Cases</h2>
          <p className="text-3xl font-semibold tabular-nums">{customersList.length}</p>
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
            {byStatus.length === 0 && <li className="text-muted-foreground">No cases yet.</li>}
          </ul>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-1 text-sm font-medium">Activated</h2>
          <p className="text-3xl font-semibold tabular-nums">{activated.length}</p>
          <p className="text-xs text-muted-foreground">of {customersList.length} total case(s)</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">Awaiting a Decision</h2>
        {awaitingDecision.length === 0 ? (
          <p className="text-sm text-muted-foreground">None right now.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {awaitingDecision.map((c) => (
              <li key={c.id} className="flex items-center justify-between border-b border-border pb-1.5 last:border-0">
                <button onClick={() => navigate(`/customers/${c.id}`)} className="text-left hover:text-primary">
                  #{c.id} — {c.legalName}
                </button>
                <StatusBadge value={c.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
