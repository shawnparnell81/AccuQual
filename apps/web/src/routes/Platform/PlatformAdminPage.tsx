import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useCurrentUser } from "../../hooks/useAuth";
import { TextField } from "../../components/forms/Field";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { DataTable, type Column } from "../../components/tables/DataTable";

interface Tenant {
  id: number;
  name: string;
  code: string;
  status: string;
  createdAt: string;
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
  const [lastResult, setLastResult] = useState<{ temporaryPassword: string; adminEmail: string } | null>(null);

  const { data: tenants = [], isLoading } = useQuery<Tenant[]>({
    queryKey: ["platform-tenants"],
    queryFn: async () => (await apiClient.get("/platform/tenants")).data,
    enabled: user?.roleName === "platform_admin",
  });

  const createTenant = useMutation({
    mutationFn: async () => (await apiClient.post("/platform/tenants", form)).data,
    onSuccess: (data) => {
      setLastResult({ temporaryPassword: data.temporaryPassword, adminEmail: form.adminEmail });
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
              Onboarding email would be sent to <strong>{lastResult.adminEmail}</strong> (no email service is wired up — see README).
              Temporary password: <code>{lastResult.temporaryPassword}</code>
            </p>
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Tenants</h2>
        <DataTable columns={columns} rows={tenants} rowKey={(t) => t.id} isLoading={isLoading} />
      </div>
    </div>
  );
}
