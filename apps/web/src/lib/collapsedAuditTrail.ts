/** Collapse state for audit trail / history panels. One choice per user, shared by every page. */

export const AUDIT_COLLAPSE_EVENT = "accuqual:audit-trail-collapse";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function auditCollapseKey(userId: number | string | null | undefined): string {
  return `accuqual.auditTrail.open.${userId ?? "anon"}`;
}

function storage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Collapsed unless this user last chose to expand. */
export function loadAuditExpanded(key: string, store: StorageLike | null = storage()): boolean {
  try {
    return store?.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function saveAuditExpanded(key: string, expanded: boolean, store: StorageLike | null = storage()): void {
  try {
    store?.setItem(key, expanded ? "1" : "0");
  } catch {
    // Storage can be blocked. The panel still opens and closes for this visit.
  }
}

/** "Audit trail (12 entries)". No count while the entries are still loading. */
export function auditPanelHeading(title: string, count: number | null): string {
  if (count == null) return title;
  return `${title} (${count} ${count === 1 ? "entry" : "entries"})`;
}
