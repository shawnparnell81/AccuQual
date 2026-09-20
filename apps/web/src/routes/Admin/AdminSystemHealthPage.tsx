import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiClient } from "../../api/client";
import { AdminOnlyGuard } from "../../components/shared/AdminOnlyGuard";
import { StatusBadge } from "../../components/tables/StatusBadge";
import type { SystemHealthReport } from "../../api/types";

function useSystemHealth() {
  return useQuery<SystemHealthReport>({
    queryKey: ["system-health"],
    queryFn: async () => (await apiClient.get("/system-health")).data,
    refetchInterval: 60_000,
  });
}

interface CardDef {
  key: keyof SystemHealthReport["checks"];
  label: string;
  stats: (check: SystemHealthReport["checks"][keyof SystemHealthReport["checks"]]) => { label: string; value: string }[];
  link?: { to: string; label: string };
}

const CARDS: CardDef[] = [
  { key: "database", label: "Database", stats: (c) => [{ label: "Latency", value: `${(c as { latencyMs: number }).latencyMs}ms` }] },
  {
    key: "ai",
    label: "AI",
    stats: (c) => {
      const ai = c as { mode: string; recentTotal: number; recentErrorCount: number };
      return [
        { label: "Mode", value: ai.mode },
        { label: "Last 7 days", value: `${ai.recentErrorCount}/${ai.recentTotal} failed` },
      ];
    },
    link: { to: "/admin/ai-settings", label: "AI Settings" },
  },
  {
    key: "workflow",
    label: "Workflow Engine",
    stats: (c) => {
      const w = c as { total: number; active: number; withIssues: number; neverRun: number };
      return [
        { label: "Active", value: `${w.active}/${w.total}` },
        { label: "With issues", value: String(w.withIssues) },
      ];
    },
    link: { to: "/workflow", label: "Workflow Builder" },
  },
  {
    key: "email",
    label: "Email",
    stats: (c) => {
      const e = c as { sent: number; failed: number; loggedOnly: number };
      return [
        { label: "Sent (7d)", value: String(e.sent) },
        { label: "Failed (7d)", value: String(e.failed) },
        { label: "Logged only", value: String(e.loggedOnly) },
      ];
    },
  },
  {
    key: "reporting",
    label: "Scheduled Reports",
    stats: (c) => {
      const r = c as { totalSchedules: number; failedSchedules: number; overdueSchedules: number };
      return [
        { label: "Total", value: String(r.totalSchedules) },
        { label: "Last failed", value: String(r.failedSchedules) },
        { label: "Overdue", value: String(r.overdueSchedules) },
      ];
    },
    link: { to: "/reporting", label: "Reporting Hub" },
  },
  {
    key: "receivingInventory",
    label: "Receiving & Inventory",
    stats: (c) => [{ label: "Below min", value: String((c as { itemsBelowMin: number }).itemsBelowMin) }],
    link: { to: "/admin/receiving-inventory-settings", label: "Settings" },
  },
  {
    key: "supplierPortal",
    label: "Supplier Portal",
    stats: (c) => {
      const s = c as { activeSupplierUsers: number; recentlyActiveCount: number };
      return [{ label: "Active last 7d", value: `${s.recentlyActiveCount}/${s.activeSupplierUsers}` }];
    },
  },
];

function MonitoringPanel({ report }: { report: SystemHealthReport }) {
  const m = report.checks.monitoring;
  const on = (v: boolean) => (v ? <span className="text-success">on</span> : <span className="text-muted-foreground">off</span>);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Monitoring &amp; alerts</h3>
        <StatusBadge value={m.status} />
      </div>
      <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        {m.alerts.map((a) => (
          <li key={a.key} className="flex items-start gap-2">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.firing ? "bg-destructive" : "bg-success"}`} />
            <span>
              <span className="font-medium">{a.title}</span>
              <span className="block text-xs text-muted-foreground">{a.firing && a.since ? `Since ${new Date(a.since).toLocaleTimeString()} — ` : ""}{a.message}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
        <span>Error tracking: {on(m.configured.errorTracking)}</span>
        <span>Alert webhook: {on(m.configured.alertWebhook)}</span>
        <span>External heartbeat: {on(m.configured.heartbeat)}</span>
        <span>Workers watched: {m.configured.workersMonitored.length > 0 ? m.configured.workersMonitored.join(", ") : <span>none</span>}</span>
        <span>Last 5 min: {m.serverErrors5m} server errors / {m.requests5m} requests</span>
        <span>Version {m.version}, up {Math.floor(m.uptimeSeconds / 3600)}h {Math.floor((m.uptimeSeconds % 3600) / 60)}m</span>
      </div>
    </div>
  );
}

function HealthCard({ def, report }: { def: CardDef; report: SystemHealthReport }) {
  const check = report.checks[def.key];
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{def.label}</h3>
        <StatusBadge value={check.status} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {def.stats(check).map((s) => (
          <span key={s.label}>
            {s.label}: <span className="font-medium text-foreground">{s.value}</span>
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{check.detail}</p>
      {def.link && (
        <Link to={def.link.to} className="mt-1 w-fit text-xs text-primary hover:underline">
          {def.link.label} →
        </Link>
      )}
    </div>
  );
}

export function AdminSystemHealthPage() {
  const { data: report, isLoading, dataUpdatedAt } = useSystemHealth();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">System Health</h1>
        <p className="text-sm text-muted-foreground">Cross-module diagnostics, checked live on every load (auto-refreshes every minute).</p>
      </div>
      <AdminOnlyGuard>
        {isLoading || !report ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
              <span className="text-sm font-medium">Overall:</span>
              <StatusBadge value={report.overall} />
              <span className="ml-auto text-xs text-muted-foreground">Last checked {new Date(dataUpdatedAt).toLocaleTimeString()}</span>
            </div>
            <MonitoringPanel report={report} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {CARDS.map((def) => (
                <HealthCard key={def.key} def={def} report={report} />
              ))}
            </div>
          </>
        )}
      </AdminOnlyGuard>
    </div>
  );
}
