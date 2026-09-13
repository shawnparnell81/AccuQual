import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { AdminOnlyGuard } from "../../components/shared/AdminOnlyGuard";
import { WorkflowTrendChart } from "../../components/charts/WorkflowTrendChart";
import type { TenantAiUsage } from "../../api/types";

function useAiUsage() {
  return useQuery<TenantAiUsage>({ queryKey: ["tenant/ai-usage"], queryFn: async () => (await apiClient.get("/tenant/ai-usage")).data });
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

const currency = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

/**
 * BYOK usage dashboard — admin only. totalTokens/totalCost are all-time
 * cumulative (real Postgres columns, incremented atomically on each AI
 * call — see ai.assistant.ts); the daily chart and per-module breakdown
 * come from real audit_trail history over the last 30 days, the exact same
 * data the monthly limit itself is enforced against (see
 * tenant.controller.ts's getAiUsageHandler) — this page and the limit
 * that blocks usage are reading the same real numbers, not two different
 * "totals" that could ever disagree.
 */
function UsageDashboard() {
  const { data, isLoading } = useAiUsage();

  if (isLoading || !data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const limitPct = data.limitEnforced && data.monthlyLimit ? Math.min((data.currentMonthTokens / data.monthlyLimit) * 100, 100) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total Tokens (all time)" value={data.totalTokens.toLocaleString()} />
        <StatCard label="Total Cost (all time, est.)" value={currency(data.totalCost)} />
        <StatCard label="This Month" value={data.currentMonthTokens.toLocaleString()} />
        <StatCard
          label={data.limitEnforced ? "Remaining This Month" : "Monthly Limit"}
          value={
            !data.limitEnforced
              ? data.monthlyLimit ? `${data.monthlyLimit.toLocaleString()} (not enforced)` : "Not set"
              : (data.remainingTokens ?? 0).toLocaleString()
          }
        />
      </div>

      {data.limitEnforced && data.monthlyLimit && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">Monthly usage</span>
            <span className="text-muted-foreground">
              {data.currentMonthTokens.toLocaleString()} / {data.monthlyLimit.toLocaleString()} tokens
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={limitPct !== null && limitPct >= 100 ? "h-full bg-destructive" : "h-full bg-primary"}
              style={{ width: `${limitPct ?? 0}%` }}
            />
          </div>
          {limitPct !== null && limitPct >= 100 && (
            <p className="mt-2 text-xs text-destructive">Limit reached — the AI Assistant will refuse new requests until next month.</p>
          )}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-medium">Usage — Last 30 Days</h2>
        {data.dailyBreakdown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No AI Assistant usage recorded in the last 30 days.</p>
        ) : (
          <WorkflowTrendChart data={data.dailyBreakdown.map((d) => ({ key: d.label, label: d.label, count: d.count }))} />
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">Per-Module Usage — Last 30 Days</h2>
        {data.moduleBreakdown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No usage to break down yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-2">Module</th>
                <th className="pb-2">Calls</th>
                <th className="pb-2">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {data.moduleBreakdown.map((m) => (
                <tr key={m.module} className="border-t border-border">
                  <td className="py-1.5 capitalize">{m.module.replace(/_/g, " ")}</td>
                  <td className="py-1.5 tabular-nums">{m.calls}</td>
                  <td className="py-1.5 tabular-nums">{m.tokens.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Cost is an estimate from a static per-model pricing table (see services/api/src/modules/ai/pricing.ts) — not a live price feed
        from your provider, and not your actual bill.
      </p>
    </div>
  );
}

export function AdminAiUsagePage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">AI Usage</h1>
      <AdminOnlyGuard>
        <UsageDashboard />
      </AdminOnlyGuard>
    </div>
  );
}
