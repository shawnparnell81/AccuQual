import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useCurrentUser } from "../../hooks/useAuth";
import { TextField, SelectField } from "../../components/forms/Field";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { DataTable, type Column } from "../../components/tables/DataTable";

interface Tenant {
  id: number;
  name: string;
  code: string;
  status: string;
  createdAt: string;
}

interface TenantAiStatus {
  tenantId: number;
  tenantName: string;
  tenantCode: string;
  enabled: boolean;
  usesOwnKey: boolean;
  mode: "disabled" | "degraded" | "live" | "stub";
  last30Days: { ok: number; stub: number; error: number };
  totalTokens: number;
  totalCost: string;
  monthlyLimit: number | null;
  limitEnforced: boolean;
}

interface AiOverview {
  platformHasKey: boolean;
  platformProvider: string;
  platformModel: string;
  tenants: TenantAiStatus[];
}

/**
 * Phase 4 AI Enablement's "AI configuration panel (Platform Admin)" — a
 * cross-tenant read-only view (each tenant's own key/provider/limits stay
 * that tenant's own Settings → Tenant AI Config, never edited from here).
 * Surfaces exactly what the phase asked for: enabled/disabled, live vs.
 * stub mode, a degraded signal when a tenant's recent AI calls are mostly
 * failing, and a real error count to investigate — computed live from
 * ai_suggestions rows, not a stored flag that could drift stale.
 */
function AiOverviewSection() {
  const { data, isLoading } = useQuery<AiOverview>({
    queryKey: ["platform-ai-overview"],
    queryFn: async () => (await apiClient.get("/platform/ai-overview")).data,
  });

  const columns: Column<TenantAiStatus>[] = [
    { header: "Tenant", accessor: (t) => `${t.tenantName} (${t.tenantCode})` },
    { header: "Mode", accessor: (t) => <StatusBadge value={t.mode} /> },
    { header: "Key Source", accessor: (t) => (t.usesOwnKey ? "Tenant BYOK" : data?.platformHasKey ? "Platform default" : "None configured") },
    { header: "Last 30 Days", accessor: (t) => `${t.last30Days.ok} ok · ${t.last30Days.stub} stub · ${t.last30Days.error} error` },
    { header: "Total Usage", accessor: (t) => `${t.totalTokens.toLocaleString()} tokens · $${Number(t.totalCost).toFixed(2)}` },
    { header: "Monthly Limit", accessor: (t) => (t.limitEnforced && t.monthlyLimit ? `${t.monthlyLimit.toLocaleString()} tokens` : "None") },
  ];

  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold">AI Status</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Platform default provider: <strong>{data?.platformHasKey ? `${data.platformProvider} (${data.platformModel})` : "not configured"}</strong>.
        Every tenant without its own key falls back to this — with neither, AI features run in stub mode everywhere.
      </p>
      <DataTable columns={columns} rows={data?.tenants ?? []} rowKey={(t) => t.tenantId} isLoading={isLoading} />
    </div>
  );
}

/**
 * Platform-admin console — tenant provisioning (see Tenant Onboarding Flow
 * Spec). The real access boundary is server-side (`requirePlatformAdmin`);
 * this page just hides itself from anyone whose role clearly isn't it.
 */
export function PlatformAdminPage() {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", code: "", adminEmail: "" });
  const [lastResult, setLastResult] = useState<{ temporaryPassword: string; adminEmail: string; emailStatus: "sent" | "logged_only" | "failed" } | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");

  const { data: tenants = [], isLoading } = useQuery<Tenant[]>({
    queryKey: ["platform-tenants"],
    queryFn: async () => (await apiClient.get("/platform/tenants")).data,
    enabled: user?.roleName === "platform_admin",
  });

  // Defaults to "active" — after Phase 1's cleanup of ~26 leftover automated-
  // test tenants (see scripts/cleanup-test-tenants.ts), this list should stay
  // small and real; a search box + status filter is what keeps it that way
  // as tenants get deactivated over time instead of silently growing back
  // into the same wall of unlabeled rows.
  const visibleTenants = useMemo(
    () =>
      tenants
        .filter((t) => statusFilter === "all" || t.status === statusFilter)
        .filter((t) => !search.trim() || t.name.toLowerCase().includes(search.trim().toLowerCase()) || t.code.toLowerCase().includes(search.trim().toLowerCase())),
    [tenants, statusFilter, search]
  );

  const createTenant = useMutation({
    mutationFn: async () => (await apiClient.post("/platform/tenants", form)).data,
    onSuccess: (data) => {
      setLastResult({ temporaryPassword: data.temporaryPassword, adminEmail: form.adminEmail, emailStatus: data.emailStatus });
      setForm({ name: "", code: "", adminEmail: "" });
      queryClient.invalidateQueries({ queryKey: ["platform-tenants"] });
    },
  });

  const deactivateTenant = useMutation({
    mutationFn: async (id: number) => (await apiClient.delete(`/platform/tenants/${id}`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["platform-tenants"] }),
  });

  if (user?.roleName !== "platform_admin") {
    return <p className="text-sm text-muted-foreground">This page is for AccuQual platform admins only.</p>;
  }

  const columns: Column<Tenant>[] = [
    { header: "ID", accessor: (t) => `#${t.id}` },
    { header: "Name", accessor: (t) => t.name },
    { header: "Code", accessor: (t) => t.code },
    { header: "Status", accessor: (t) => <StatusBadge value={t.status} /> },
    {
      header: "Action",
      accessor: (t) =>
        t.status === "active" ? (
          <button
            onClick={() => deactivateTenant.mutate(t.id)}
            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
          >
            Deactivate
          </button>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.5fr]">
      <div className="rounded-lg border border-border bg-card p-4">
        <h1 className="mb-3 text-lg font-semibold">Provision a Tenant</h1>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            createTenant.mutate();
          }}
        >
          <TextField label="Company name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <TextField
            label="Tenant code"
            placeholder="e.g. acme-mfg"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            required
          />
          <TextField
            label="Admin email"
            type="email"
            value={form.adminEmail}
            onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
            required
          />
          <button type="submit" disabled={createTenant.isPending} className="rounded-md bg-primary py-2 text-sm text-primary-foreground">
            {createTenant.isPending ? "Provisioning…" : "Create tenant"}
          </button>
        </form>

        {lastResult && (
          <div className="mt-4 rounded-md border border-border bg-muted p-3 text-xs">
            <p className="font-medium">Tenant created.</p>
            <p className="mt-1">
              {lastResult.emailStatus === "sent" && (
                <>
                  Onboarding email sent to <strong>{lastResult.adminEmail}</strong>.
                </>
              )}
              {lastResult.emailStatus === "logged_only" && (
                <>
                  Onboarding email logged for <strong>{lastResult.adminEmail}</strong> — no SMTP provider is configured for this
                  environment (set SMTP_HOST/PORT/USER/PASSWORD to enable real delivery), so nothing was actually sent.
                </>
              )}
              {lastResult.emailStatus === "failed" && (
                <>
                  Couldn&apos;t deliver the onboarding email to <strong>{lastResult.adminEmail}</strong> after retrying — share the
                  temporary password below with them directly.
                </>
              )}{" "}
              Temporary password: <code>{lastResult.temporaryPassword}</code>
            </p>
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Tenants</h2>
        <div className="mb-3 flex flex-wrap gap-3">
          <TextField label="Search" placeholder="Name or code" value={search} onChange={(e) => setSearch(e.target.value)} />
          <SelectField label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </SelectField>
        </div>
        <DataTable columns={columns} rows={visibleTenants} rowKey={(t) => t.id} isLoading={isLoading} />
        {!isLoading && tenants.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Showing {visibleTenants.length} of {tenants.length} tenant(s).
          </p>
        )}
      </div>

      <div className="lg:col-span-2">
        <AiOverviewSection />
      </div>
    </div>
  );
}
