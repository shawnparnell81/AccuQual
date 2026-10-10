import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { useSearchParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { PageHeader } from "../../components/layout/PageHeader";
import { useOpenTab } from "../../hooks/useOpenTab";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { canViewModule, drillDetail, drillHeading, permissionMessage, tabIconForHref, type DrillTarget } from "../../lib/executiveDrill";

interface DrillRow {
  recordNumber: string;
  title: string;
  status: string;
  ageLabel: string;
  href: string | null;
  module: string | null;
}

interface DrillPayload {
  title: string;
  siteName: string;
  total: number;
  rows: DrillRow[];
}

function rowLabel(row: DrillRow): string {
  return `${row.recordNumber} ${row.title}`.trim();
}

export function DrillRows({
  rows,
  onDenied,
}: {
  rows: DrillRow[];
  onDenied: (message: string) => void;
}) {
  const openTab = useOpenTab();
  const { effective, isLoading } = useEffectivePermissions();

  return (
    <ul className="flex flex-col divide-y divide-border">
      {rows.map((row, index) => {
        const label = rowLabel(row);
        const allowed = row.href != null && canViewModule(row.module, effective, isLoading);
        const tip = row.href == null ? "This record has no page to open." : allowed ? `Open ${label}` : permissionMessage(row.module);
        if (!row.href || !allowed) {
          return (
            <li key={`${row.recordNumber}-${index}`} className="py-2">
              <span className="flex cursor-not-allowed items-baseline justify-between gap-3" title={tip}>
                <span className="truncate text-sm text-muted-foreground">{label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{row.href == null ? "No page" : "No access"}</span>
              </span>
            </li>
          );
        }
        return (
          <li key={`${row.href}-${index}`} className="py-1">
            <button
              type="button"
              className="flex w-full cursor-pointer items-baseline justify-between gap-3 rounded-md px-1 py-1 text-left hover:bg-muted focus-visible:outline focus-visible:ring-2 focus-visible:ring-ring"
              title={tip}
              onClick={() => {
                if (!canViewModule(row.module, effective, isLoading)) {
                  onDenied(permissionMessage(row.module));
                  return;
                }
                openTab({ path: row.href!, title: label, icon: tabIconForHref(row.href!) });
              }}
            >
              <span className="truncate text-sm text-foreground">{label}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {row.status} · {row.ageLabel}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function ExecutiveDrillListPage() {
  const [params] = useSearchParams();
  const [denied, setDenied] = useState<string | null>(null);
  const kind = params.get("kind") ?? "";
  const bucket = params.get("bucket") ?? "";
  const dateRange = params.get("dateRange") ?? "";
  const siteRaw = params.get("siteId") ?? "";
  const siteId = siteRaw === "unassigned" || siteRaw === "" ? null : Number(siteRaw);
  const records = useQuery({
    queryKey: ["executive-list", kind, bucket, dateRange, siteRaw],
    enabled: kind.length > 0 && bucket.length > 0 && dateRange.length > 0,
    queryFn: async () => {
      const query = new URLSearchParams({ kind, bucket, dateRange, siteId: siteRaw || "unassigned" });
      return (await apiClient.get<DrillPayload>(`/executive/records?${query.toString()}`)).data;
    },
  });

  if (!kind || !bucket || !dateRange) {
    return <p className="text-sm text-muted-foreground">Choose a number on the executive dashboard to open its list.</p>;
  }
  if (records.isLoading) return <LoadingPlaceholder />;
  if (records.isError && axios.isAxiosError(records.error) && records.error.response?.status === 403) {
    return <p className="rounded-lg border border-border bg-card p-4 text-sm text-foreground">You don't have access to the executive dashboard.</p>;
  }
  if (records.isError || !records.data) return <p className="text-sm text-destructive">Couldn't load those records.</p>;

  const target: DrillTarget = {
    kind,
    bucket,
    label: records.data.title,
    dateRange,
    siteId: Number.isInteger(siteId) ? siteId : null,
    siteName: records.data.siteName,
    value: records.data.total,
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader crumbs={[{ label: "Executive dashboard", to: "/executive" }, { label: drillHeading(target) }]} title={drillHeading(target)} description={drillDetail(kind, bucket)} />
      <p className="text-sm text-muted-foreground">
        {records.data.total} {records.data.total === 1 ? "record" : "records"}
        {records.data.rows.length < records.data.total ? ` · showing ${records.data.rows.length}` : ""}
      </p>
      {denied && <p className="rounded-lg border border-border bg-card p-4 text-sm text-foreground">{denied}</p>}
      {records.data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No records in this count.</p>
      ) : (
        <DrillRows rows={records.data.rows} onDenied={setDenied} />
      )}
    </div>
  );
}
