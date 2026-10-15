import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";

/** Shown when a record page is refused, so a missing permission is not a blank page. */
export function RecordAccessMessage({ error, fallback, noun }: { error: unknown; fallback: string; noun: string }) {
  const queryClient = useQueryClient();
  const denied = axios.isAxiosError(error) && error.response?.status === 403;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4 text-sm text-foreground">
      <p>{denied ? `You don't have permission to view ${noun}.` : fallback}</p>
      {!denied && (
        // A load can fail for a moment (deploy or network). Retry asks again without reloading the page.
        <button type="button" className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted" onClick={() => void queryClient.refetchQueries({ type: "active" })}>
          Retry
        </button>
      )}
    </div>
  );
}
