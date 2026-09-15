import type { ErpSyncStatusHistoryEntry } from "../../api/types";

const STATUS_STYLE: Record<ErpSyncStatusHistoryEntry["status"], string> = {
  success: "bg-success/10 text-success",
  failed: "bg-destructive/10 text-destructive",
  skipped: "bg-muted text-muted-foreground",
};

/** erpSyncSettings.statusHistory — a real run log (capped at 20 entries, newest first) written by settings.erpSync.ts's triggerErpSync, not a fabricated activity feed. */
export function SyncStatusHistoryViewer({ history }: { history: ErpSyncStatusHistoryEntry[] }) {
  if (history.length === 0) {
    return <p className="text-sm text-muted-foreground">No sync has run yet — click "Trigger Sync Now" to run one.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {history.map((entry, i) => (
        <li key={i} className="flex flex-col gap-1 rounded-md border border-border bg-background px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[entry.status]}`}>{entry.status}</span>
            <span className="text-xs text-muted-foreground">{new Date(entry.at).toLocaleString()}</span>
          </div>
          {entry.modules.length > 0 && <span className="text-xs text-muted-foreground">Modules: {entry.modules.join(", ")}</span>}
          {entry.message && <span className="text-xs">{entry.message}</span>}
        </li>
      ))}
    </ul>
  );
}
