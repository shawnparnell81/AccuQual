import axios from "axios";

/** Shown when a record page is refused, so a missing permission is not a blank page. */
export function RecordAccessMessage({ error, fallback, noun }: { error: unknown; fallback: string; noun: string }) {
  const denied = axios.isAxiosError(error) && error.response?.status === 403;
  return (
    <p className="rounded-lg border border-border bg-card p-4 text-sm text-foreground">
      {denied ? `You don't have permission to view ${noun}.` : fallback}
    </p>
  );
}
