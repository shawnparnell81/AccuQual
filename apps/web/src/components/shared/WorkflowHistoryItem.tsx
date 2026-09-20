import { useState } from "react";
import {
  CheckCircle2,
  FilePenLine,
  Lock,
  Clock,
  XCircle,
  Ban,
  PlusCircle,
  Trash2,
  RefreshCw,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import { WorkflowMetadataViewer } from "./WorkflowMetadataViewer";
import { formatDateTime } from "../../lib/dates";
import type { FieldChange, WorkflowHistoryEntry } from "../../api/types";

type Bucket = "muted" | "info" | "warning" | "success" | "destructive";

const BUCKET_CLASSES: Record<Bucket, string> = {
  muted: "bg-muted text-muted-foreground",
  info: "bg-info/15 text-info",
  warning: "bg-warning/15 text-warning",
  success: "bg-success/15 text-success",
  destructive: "bg-destructive/15 text-destructive",
};

/**
 * Icon + color per transition, keyed primarily off `changes.action` (the
 * curated transition name, e.g. "close", "approve" — see the Audit Trail
 * Dictionary's two-level action format), falling back to the outer
 * `action` column for generic/failed entries. Best-effort pattern match,
 * not an exhaustive per-module switch — new transition names still render
 * sensibly via the default case instead of needing this list extended.
 */
function resolveVisual(entry: WorkflowHistoryEntry): { icon: LucideIcon; bucket: Bucket } {
  if (entry.action === "transition_failed") return { icon: XCircle, bucket: "destructive" };
  if (entry.action === "delete") return { icon: Trash2, bucket: "destructive" };
  if (entry.action === "create") return { icon: PlusCircle, bucket: "muted" };

  const specific = typeof entry.changes?.action === "string" ? (entry.changes.action as string) : "";
  if (/close/i.test(specific)) return { icon: Lock, bucket: "success" };
  if (/approve|verify/i.test(specific)) return { icon: CheckCircle2, bucket: "success" };
  if (/complete/i.test(specific)) return { icon: CheckCircle2, bucket: "success" };
  if (/revise|upload/i.test(specific)) return { icon: FilePenLine, bucket: "info" };
  if (/expire/i.test(specific)) return { icon: Clock, bucket: "warning" };
  if (/suspend|disqualif|remove/i.test(specific)) return { icon: Ban, bucket: "destructive" };
  return { icon: RefreshCw, bucket: "info" };
}

function summarize(entry: WorkflowHistoryEntry): string {
  if (entry.action === "transition_failed") {
    return typeof entry.changes?.errorMessage === "string" ? entry.changes.errorMessage : "Transition failed";
  }
  const label = typeof entry.changes?.action === "string" ? (entry.changes.action as string) : entry.action;
  return label.replace(/_/g, " ");
}

/** Best-effort resulting status, when the writer included one — see the Audit Trail Dictionary section 1: there's no stored "fromState", only whatever the write actually changed. */
function resultingStatus(entry: WorkflowHistoryEntry): string | null {
  const patch = entry.changes?.patch as Record<string, unknown> | undefined;
  const status = patch?.status ?? entry.changes?.status ?? entry.changes?.to;
  return typeof status === "string" ? status : null;
}

const HIDDEN = "[redacted]";

/** "assigned_to" -> "Assigned to" */
function fieldLabel(column: string): string {
  const spaced = column.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "empty";
  if (typeof value === "boolean") return value ? "yes" : "no";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 80 ? text.slice(0, 80) + "…" : text;
}

interface FieldRow {
  key: string;
  label: string;
  from?: string;
  to?: string;
  hidden: boolean;
}

function toRows(fieldChanges: FieldChange[] | undefined, ops: FieldChange["op"][]): FieldRow[] {
  return (fieldChanges ?? [])
    .filter((c) => ops.includes(c.op))
    .flatMap((c) =>
      Object.entries(c.changes).map(([column, v]) => ({
        key: `${c.table}.${column}`,
        label: fieldLabel(column),
        from: "from" in v ? formatValue(v.from) : undefined,
        to: "to" in v ? formatValue(v.to) : undefined,
        hidden: v.from === HIDDEN || v.to === HIDDEN,
      }))
    );
}

/** "Priority: low → high" lines — what actually changed, and from what, not just which fields were touched. */
function FieldChangeList({ rows, limit }: { rows: FieldRow[]; limit?: number }) {
  if (rows.length === 0) return null;
  const shown = limit ? rows.slice(0, limit) : rows;
  return (
    <ul className="mt-1.5 flex flex-col gap-0.5 text-xs">
      {shown.map((r) => (
        <li key={r.key} className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="font-medium text-foreground">{r.label}:</span>
          {r.hidden ? (
            <span className="text-muted-foreground">changed (value hidden)</span>
          ) : r.from !== undefined && r.to !== undefined ? (
            <>
              <span className="text-muted-foreground line-through decoration-muted-foreground/50">{r.from}</span>
              <span className="text-muted-foreground">→</span>
              <span className="text-foreground">{r.to}</span>
            </>
          ) : (
            <span className="text-foreground">{r.to ?? r.from}</span>
          )}
        </li>
      ))}
      {limit && rows.length > limit && <li className="text-muted-foreground">+{rows.length - limit} more in Details</li>}
    </ul>
  );
}

export function WorkflowHistoryItem({ entry, highlighted }: { entry: WorkflowHistoryEntry; highlighted?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { icon: Icon, bucket } = resolveVisual(entry);
  const toStatus = resultingStatus(entry);
  const editRows = toRows(entry.fieldChanges, ["UPDATE", "DELETE"]);
  const allRows = toRows(entry.fieldChanges, ["INSERT", "UPDATE", "DELETE"]);

  return (
    <li
      id={`history-${entry.id}`}
      className={clsx("scroll-mt-4 border-b border-border pb-3 last:border-0", highlighted && "rounded-md bg-primary/5 ring-1 ring-primary/40")}
    >
      <div className="flex items-start gap-3 py-1">
        <span className={clsx("mt-0.5 flex-none rounded-full p-1.5", BUCKET_CLASSES[bucket])}>
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className={clsx("font-medium", entry.action !== "transition_failed" && "capitalize")}>{summarize(entry)}</span>
            <span className="flex-none text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{entry.performedByName ?? "System"}</span>
            {toStatus && <span>→ now {toStatus.replace(/_/g, " ")}</span>}
            <button onClick={() => setExpanded((e) => !e)} className="ml-auto flex items-center gap-1 text-primary hover:underline">
              Details <ChevronDown size={12} className={clsx("transition-transform", expanded && "rotate-180")} />
            </button>
          </div>
          <FieldChangeList rows={editRows} limit={5} />
          {expanded && (
            <div className="mt-2 rounded-md border border-border bg-card p-3">
              {allRows.length > 0 && (
                <div className="mb-2 border-b border-border pb-2">
                  <p className="text-xs font-medium text-muted-foreground">Field changes</p>
                  <FieldChangeList rows={allRows} />
                </div>
              )}
              <WorkflowMetadataViewer changes={entry.changes} />
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
