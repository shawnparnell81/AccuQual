import type { WorkflowHistoryEntry } from "../api/types";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function historyNote(entries: WorkflowHistoryEntry[] | undefined, action: string, keys: string[]): string {
  for (const entry of entries ?? []) {
    const changes = entry.changes;
    if (!changes) continue;
    const code = typeof changes.action === "string" ? changes.action : typeof changes.event === "string" ? changes.event : "";
    if (code !== action) continue;
    for (const key of keys) {
      const value = text(changes[key]);
      if (value) return value;
    }
  }
  return "";
}

/** Text recorded on the six-step NCR, including steps that used to live only on the audit row. */
export function ncrRecordedSteps(
  ncr: {
    containment: string | null;
    rootCause: string | null;
    correctiveAction: string | null;
    processData?: Record<string, unknown> | null;
  },
  history?: WorkflowHistoryEntry[],
) {
  const data = ncr.processData ?? {};
  return {
    containment: text(ncr.containment),
    cause: text(ncr.rootCause),
    disposition: text(data.dispositionNote) || historyNote(history, "disposition", ["note"]),
    fix: text(ncr.correctiveAction),
    verify: text(data.verification) || historyNote(history, "verify", ["verification", "note"]),
  };
}
