import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { AdminOnlyGuard } from "../../components/shared/AdminOnlyGuard";
import { WorkflowTrendChart } from "../../components/charts/WorkflowTrendChart";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { SelectField } from "../../components/forms/Field";
import type { CompanyAiUsage, AiSuggestionHistoryResponse } from "../../api/types";

function useAiUsage() {
  return useQuery<CompanyAiUsage>({ queryKey: ["company/ai-usage"], queryFn: async () => (await apiClient.get("/company/ai-usage")).data });
}

// The real, complete set of `module` values any ai_suggestions row can ever
// carry — every literal string passed to runPipelineAndRecord/
// recordAiSuggestion across ai.controller.ts. ai.assistant.ts's own usage
// never appears here at all (it logs to audit_trail as "AiAssistantMessage",
// never to ai_suggestions), and riskScore's free-text 0-100 scorer writes to
// the separate ai_risk_scores table — neither is part of this history.
const SUGGESTION_MODULES = ["ncr", "capa", "8d", "form", "analysis", "supplier", "warranty", "quality_inspection"] as const;
const SUGGESTION_STATUSES = ["ok", "stub", "malformed", "error"] as const;
const PAGE_SIZE = 20;

function useAiSuggestionHistory(filters: { module: string; status: string; offset: number }) {
  return useQuery<AiSuggestionHistoryResponse>({
    queryKey: ["ai/suggestions", filters],
    queryFn: async () =>
      (
        await apiClient.get("/ai/suggestions", {
          params: { module: filters.module || undefined, status: filters.status || undefined, limit: PAGE_SIZE, offset: filters.offset },
        })
      ).data,
  });
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
 * company.controller.ts's getAiUsageHandler) — this page and the limit
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

/**
 * Real, browsable AI suggestion history — previously ai_suggestions could
 * only ever be inspected one row at a time (the accept/reject dialog, at
 * the moment it's generated) or as an aggregate count.
 * This is the first place an
 * admin can actually see what the AI has produced over time, filter it,
 * and see whether each suggestion was accepted or rejected.
 */
function SuggestionHistory() {
  const [module, setModule] = useState("");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const { data, isLoading } = useAiSuggestionHistory({ module, status, offset });

  const resetAndSet = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setOffset(0);
    setExpandedId(null);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">AI Suggestion History</h2>
        <div className="flex gap-2">
          <SelectField label="" value={module} onChange={(e) => resetAndSet(setModule)(e.target.value)}>
            <option value="">All modules</option>
            {SUGGESTION_MODULES.map((m) => (
              <option key={m} value={m}>
                {m.replace(/_/g, " ")}
              </option>
            ))}
          </SelectField>
          <SelectField label="" value={status} onChange={(e) => resetAndSet(setStatus)(e.target.value)}>
            <option value="">All statuses</option>
            {SUGGESTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </SelectField>
        </div>
      </div>

      {isLoading || !data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No AI suggestions match these filters yet.</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-2">When</th>
                <th className="pb-2">Module</th>
                <th className="pb-2">Pipeline</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Decision</th>
                <th className="pb-2">By</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((s) => (
                <Fragment key={s.id}>
                  <tr className="border-t border-border">
                    <td className="py-1.5 text-muted-foreground">{new Date(s.createdAt).toLocaleString()}</td>
                    <td className="py-1.5 capitalize">{s.module?.replace(/_/g, " ") ?? "—"}</td>
                    <td className="py-1.5 capitalize">{s.pipeline?.replace(/_/g, " ") ?? "—"}</td>
                    <td className="py-1.5">
                      <StatusBadge value={s.status} />
                    </td>
                    <td className="py-1.5">{s.decision ? <StatusBadge value={s.decision} /> : <span className="text-muted-foreground">Not decided</span>}</td>
                    <td className="py-1.5 text-muted-foreground">{s.createdByName}</td>
                    <td className="py-1.5 text-right">
                      <button type="button" onClick={() => setExpandedId(expandedId === s.id ? null : s.id)} className="text-xs text-primary hover:underline">
                        {expandedId === s.id ? "Hide" : "View"}
                      </button>
                    </td>
                  </tr>
                  {expandedId === s.id && (
                    <tr className="border-t border-border bg-muted/30">
                      <td colSpan={7} className="py-3">
                        {s.errorMessage && <p className="mb-2 text-xs text-destructive">{s.errorMessage}</p>}
                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <p className="mb-1 text-xs font-medium text-muted-foreground">Input</p>
                            <pre className="max-h-64 overflow-auto rounded-md bg-background p-2 text-xs">{JSON.stringify(s.input, null, 2)}</pre>
                          </div>
                          <div>
                            <p className="mb-1 text-xs font-medium text-muted-foreground">Output</p>
                            <pre className="max-h-64 overflow-auto rounded-md bg-background p-2 text-xs">{JSON.stringify(s.output, null, 2)}</pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>

          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {data.total === 0 ? "0 results" : `${offset + 1}–${Math.min(offset + PAGE_SIZE, data.total)} of ${data.total}`}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOffset((o) => Math.max(o - PAGE_SIZE, 0))}
                disabled={offset === 0}
                className="rounded-md border border-border px-2 py-1 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                disabled={offset + PAGE_SIZE >= data.total}
                className="rounded-md border border-border px-2 py-1 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function AdminAiUsagePage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">AI Usage</h1>
      <AdminOnlyGuard>
        <UsageDashboard />
        <SuggestionHistory />
      </AdminOnlyGuard>
    </div>
  );
}
