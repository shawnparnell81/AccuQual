/** Category stored on documents that live in Quality → Obsolete / Archive. Matches the web folder key. */
export const OBSOLETE_ARCHIVE_CATEGORY = "obsolete-archive";

export const ARCHIVED_READ_ONLY = "This document is in Obsolete / Archive and is read-only. An administrator has to restore it before it can be changed.";

export function isInObsoleteArchive(doc: { status: string; category: string | null }): boolean {
  return doc.status === "obsolete" && doc.category === OBSOLETE_ARCHIVE_CATEGORY;
}
