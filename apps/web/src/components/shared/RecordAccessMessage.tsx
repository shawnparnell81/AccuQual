import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";

/** What a record page says when its record could not be read. */
export function recordAccessText(error: unknown, fallback: string, noun: string): string {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  if (status === 403) return `You don't have permission to view ${noun}.`;
  if (status === 404) return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} was not found. It may have been deleted.`;
  if (status === 429) return `The server is busy right now, so ${noun} didn't load. Try again in a minute.`;
  return fallback;
}

/** Shown when a record page is refused, so a missing permission is not a blank page. */
export function RecordAccessMessage({ error, fallback, noun }: { error: unknown; fallback: string; noun: string }) {
  const queryClient = useQueryClient();
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  const retryable = status !== 403 && status !== 404;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4 text-sm text-foreground">
      <p>{recordAccessText(error, fallback, noun)}</p>
      {retryable && (
        // A load can fail for a moment (deploy, network, or a busy server). Retry asks again without reloading the page.
        <button type="button" className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted" onClick={() => void queryClient.refetchQueries({ type: "active" })}>
          Retry
        </button>
      )}
    </div>
  );
}
