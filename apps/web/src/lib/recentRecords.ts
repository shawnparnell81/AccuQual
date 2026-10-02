const KEY = "accuqual-recent-records";
const MAX = 8;

function bucket(userId?: number | null) {
  return userId == null ? KEY : `${KEY}:user:${userId}`;
}

export interface RecentRecord {
  path: string;
  title: string;
  type: string;
}

export function readRecentRecords(userId?: number | null): RecentRecord[] {
  try {
    const raw = localStorage.getItem(bucket(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is RecentRecord => {
      if (!row || typeof row !== "object") return false;
      const item = row as RecentRecord;
      return typeof item.path === "string" && typeof item.title === "string" && typeof item.type === "string";
    });
  } catch {
    return [];
  }
}

export function rememberRecord(record: RecentRecord, userId?: number | null): RecentRecord[] {
  const next = [record, ...readRecentRecords(userId).filter((row) => row.path !== record.path)].slice(0, MAX);
  try {
    localStorage.setItem(bucket(userId), JSON.stringify(next));
  } catch {
    // Preference only.
  }
  return next;
}
