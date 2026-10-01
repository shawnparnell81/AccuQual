/** Category stored on documents that live in Quality → Obsolete / Archive. Matches the web folder key. */
export const OBSOLETE_ARCHIVE_CATEGORY = "obsolete-archive";

export const ARCHIVED_READ_ONLY = "This document is in Obsolete / Archive and is read-only. An administrator has to restore it before it can be changed.";

export function isInObsoleteArchive(doc: { status: string; category: string | null }): boolean {
  return doc.status === "obsolete" && doc.category === OBSOLETE_ARCHIVE_CATEGORY;
}

/** Retire writes the same lock move-to-archive uses: obsolete, and the archive folder. Only this document. */
export function retiredDocumentWrite(doc: { category: string | null; status: string }) {
  return {
    category: OBSOLETE_ARCHIVE_CATEGORY,
    status: "obsolete" as const,
    changes: {
      action: "obsolete" as const,
      fromCategory: doc.category,
      toCategory: OBSOLETE_ARCHIVE_CATEGORY,
      fromStatus: doc.status,
      status: "obsolete" as const,
    },
  };
}

const ARCHIVE_HISTORY_ACTIONS = new Set(["moved_to_obsolete", "obsolete"]);

/** Folder and status to restore. The newest retire or move-to-archive row wins. */
export function folderBeforeArchive(history: { changes?: unknown }[]): { fromCategory: string | null; fromStatus: string } {
  const move = [...history].reverse().find((row) => {
    const action = (row.changes as { action?: string } | null)?.action;
    return action != null && ARCHIVE_HISTORY_ACTIONS.has(action);
  });
  const changes = (move?.changes ?? {}) as { fromCategory?: unknown; fromStatus?: unknown };
  const fromCategory = typeof changes.fromCategory === "string" && changes.fromCategory !== OBSOLETE_ARCHIVE_CATEGORY ? changes.fromCategory : null;
  const fromStatus = typeof changes.fromStatus === "string" && changes.fromStatus !== "obsolete" ? changes.fromStatus : "draft";
  return { fromCategory, fromStatus };
}
