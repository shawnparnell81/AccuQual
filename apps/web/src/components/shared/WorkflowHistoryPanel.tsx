import { useEffect, useState } from "react";
import { AlertTriangle, History } from "lucide-react";
import clsx from "clsx";
import { useWorkflowHistory } from "../../hooks/useWorkflowHistory";
import { WorkflowHistoryItem } from "./WorkflowHistoryItem";
import type { WorkflowModuleName } from "../../api/types";

/** Reads a #history-<id> URL hash, if present, to auto-scroll/highlight one entry — a plain page anchor, no router changes needed. */
function useDeepLinkedEntryId(): number | null {
  const [id, setId] = useState<number | null>(null);
  useEffect(() => {
    const match = /^#history-(\d+)$/.exec(window.location.hash);
    if (match) setId(Number(match[1]));
  }, []);
  return id;
}

/**
 * The one shared history panel every module's detail page uses — fetches
 * GET /workflow/history/:moduleName/:recordId (Phase 6) and renders it as a
 * chronological timeline. Backend already sorts newest-first; sorted again
 * here defensively since "sort chronologically" is an explicit contract of
 * this component, not something callers should have to trust upstream.
 *
 * `bare` skips the card chrome (border/background/title) for contexts that
 * already provide their own — e.g. TrainingHistoryPanel's per-assignment
 * <details> rows, where a full nested card would just be a box in a box.
 */
export function WorkflowHistoryPanel({
  moduleName,
  recordId,
  title = "History",
  bare = false,
}: {
  moduleName: WorkflowModuleName;
  recordId: number | undefined;
  title?: string;
  bare?: boolean;
}) {
  const { data, isLoading, isError, refetch, isFetching } = useWorkflowHistory(moduleName, recordId);
  const deepLinkedId = useDeepLinkedEntryId();

  useEffect(() => {
    if (deepLinkedId === null || !data) return;
    document.getElementById(`history-${deepLinkedId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [deepLinkedId, data]);

  const entries = [...(data ?? [])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className={clsx(!bare && "rounded-lg border border-border bg-card p-4")}>
      {!bare && (
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <History size={15} className="text-muted-foreground" /> {title}
          </h3>
          {isFetching && !isLoading && <span className="text-xs text-muted-foreground">Refreshing…</span>}
        </div>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Loading history…</p>}

      {isError && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span className="flex items-center gap-2">
            <AlertTriangle size={14} /> Couldn't load history.
          </span>
          <button onClick={() => refetch()} className="rounded-md border border-destructive/40 px-2 py-1 text-xs hover:bg-destructive/10">
            Retry
          </button>
        </div>
      )}

      {!isLoading && !isError && entries.length === 0 && <p className="text-sm text-muted-foreground">No history yet — actions on this record will appear here.</p>}

      {!isLoading && !isError && entries.length > 0 && (
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => (
            <WorkflowHistoryItem key={entry.id} entry={entry} highlighted={entry.id === deepLinkedId} />
          ))}
        </ul>
      )}
    </div>
  );
}
