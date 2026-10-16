import axios from "axios";

/** How many times a read is tried again when the server is busy (429/503) or the connection dropped. */
export const BUSY_RETRIES = 4;
const MAX_WAIT_MS = 30_000;

function statusOf(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined;
}

/**
 * Whether a page read is tried again. A busy server or a dropped connection is retried a few times, so a record page
 * does not show "Couldn't load" for a momentary limit. A refusal or a missing record (other 4xx) is not retried.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const status = statusOf(error);
  if (status == null || status === 429 || status === 503 || status === 502 || status === 504) return failureCount < BUSY_RETRIES;
  if (status >= 400 && status < 500) return false;
  return failureCount < 1;
}

/** Waits for Retry-After when the server sends it, otherwise 1 s, 2 s, 4 s, ... capped at 30 s. */
export function queryRetryDelay(failureCount: number, error: unknown): number {
  const header = axios.isAxiosError(error) ? error.response?.headers?.["retry-after"] : undefined;
  const seconds = typeof header === "string" || typeof header === "number" ? Number(header) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_WAIT_MS, Math.max(1_000, seconds * 1000));
  return Math.min(MAX_WAIT_MS, 1_000 * 2 ** Math.max(0, failureCount));
}
