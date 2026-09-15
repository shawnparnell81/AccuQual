import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import type { SalesAccount } from "../../api/types";
import { StatusBadge } from "../../components/tables/StatusBadge";

const salesAccountHooks = createResourceHooks<SalesAccount>("sales/accounts");

/**
 * Accounts by status, open quotes/contracts pipeline, and an activity
 * worklist for accounts with a near-term due date. The list endpoint only
 * returns bare account rows (see sales.controller.ts's listAccountsHandler),
 * so the pipeline/follow-up figures fetch each account's own detail (which
 * DOES nest activities/quotes/contracts, see getAccountHandler) — fine at
 * this module's real scale (a lightweight CRM, not a high-volume list).
 */
export function SalesDashboardPage() {
  const navigate = useNavigate();
  const { data: accountRows = [], isLoading: listLoading } = salesAccountHooks.useList();

  const detailQueries = useQueries({
    queries: accountRows.map((a) => ({
      queryKey: ["sales/accounts", a.id],
      queryFn: async () => (await apiClient.get<SalesAccount>(`/sales/accounts/${a.id}`)).data,
      enabled: accountRows.length > 0,
    })),
  });
  const detailsLoading = detailQueries.some((q) => q.isLoading);
  const accounts = detailQueries.every((q) => q.data) && detailQueries.length === accountRows.length ? (detailQueries.map((q) => q.data) as SalesAccount[]) : accountRows;
  const isLoading = listLoading || detailsLoading;

  const byStatus = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of accounts) counts.set(a.status, (counts.get(a.status) ?? 0) + 1);
    return [...counts.entries()];
  }, [accounts]);

  const openQuotes = useMemo(() => accounts.flatMap((a) => (a.quotes ?? []).filter((q) => q.status === "draft" || q.status === "submitted").map((q) => ({ account: a, quote: q }))), [accounts]);

  const activeContracts = useMemo(() => accounts.flatMap((a) => (a.contracts ?? []).filter((c) => c.status === "active").map((c) => ({ account: a, contract: c }))), [accounts]);

  const upcomingActivities = useMemo(
    () =>
      accounts
        .flatMap((a) => (a.activities ?? []).filter((act) => act.dueDate).map((act) => ({ account: a, activity: act })))
        .sort((x, y) => new Date(x.activity.dueDate!).getTime() - new Date(y.activity.dueDate!).getTime())
        .slice(0, 10),
    [accounts]
  );

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Sales &amp; Marketing Dashboard</h1>
          <p className="text-sm text-muted-foreground">Accounts, open quotes, active contracts, and upcoming follow-ups.</p>
        </div>
        <button onClick={() => navigate("/sales")} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
          Back to list
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-1 text-sm font-medium">Total Accounts</h2>
          <p className="text-3xl font-semibold tabular-nums">{accounts.length}</p>
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
            {byStatus.length === 0 && <li className="text-muted-foreground">No accounts yet.</li>}
          </ul>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-1 text-sm font-medium">Pipeline</h2>
          <p className="text-sm text-muted-foreground">
            <b className="text-foreground">{openQuotes.length}</b> open quote(s), <b className="text-foreground">{activeContracts.length}</b> active contract(s)
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-medium">Open Quotes</h2>
          {openQuotes.length === 0 ? (
            <p className="text-sm text-muted-foreground">None right now.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {openQuotes.map(({ account, quote }) => (
                <li key={quote.id} className="flex items-center justify-between border-b border-border pb-1.5 last:border-0">
                  <button onClick={() => navigate(`/sales/${account.id}`)} className="text-left hover:text-primary">
                    {quote.quoteNumber} — {account.customerName}
                  </button>
                  <StatusBadge value={quote.status} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-medium">Upcoming Follow-ups</h2>
          {upcomingActivities.length === 0 ? (
            <p className="text-sm text-muted-foreground">None scheduled.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {upcomingActivities.map(({ account, activity }) => (
                <li key={activity.id} className="flex items-center justify-between border-b border-border pb-1.5 last:border-0">
                  <button onClick={() => navigate(`/sales/${account.id}`)} className="text-left hover:text-primary">
                    {account.customerName} — {activity.nextSteps ?? activity.activityType.replace(/_/g, " ")}
                  </button>
                  <span className="text-xs text-muted-foreground">{activity.dueDate}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
