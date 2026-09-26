import * as Sentry from "@sentry/node";
import { env } from "../../config/env.js";
import { getRequestContext } from "./requestContext.js";

/**
 * Error tracking (opt-in). With SENTRY_DSN unset every function here is a no-op, so nothing changes for a deployment
 * that doesn't use it. Set it and unhandled errors, failed 5xx requests and crashes arrive in Sentry with the request
 * id and user id attached — ids only. Request bodies, headers, cookies and query strings never leave the
 * server: a quality system's payloads are customers' records, and a stack trace is enough to fix a bug.
 */
let enabled = false;

const SENSITIVE_KEYS = /^(authorization|cookie|set-cookie|x-device-key|x-api-key)$/i;

/** Strips everything that could carry customer data or credentials from an event before it is sent. */
export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.headers) for (const k of Object.keys(event.request.headers)) if (SENSITIVE_KEYS.test(k)) delete event.request.headers[k];
    if (event.request.url) event.request.url = event.request.url.split("?")[0]!;
  }
  if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
  return event;
}

export function initSentry(): void {
  if (!env.SENTRY_DSN || enabled) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    release: env.APP_VERSION,
    sendDefaultPii: false,
    tracesSampleRate: 0, // errors only — no performance tracing, no extra egress
    beforeSend: scrubEvent,
  });
  enabled = true;
}

export const sentryEnabled = (): boolean => enabled;

/** Reports an error with the current request's ids. Never throws. */
export function captureError(err: unknown, extra: Record<string, unknown> = {}): void {
  if (!enabled) return;
  try {
    const ctx = getRequestContext();
    Sentry.withScope((scope) => {
      if (ctx?.requestId) scope.setTag("request_id", ctx.requestId);
      if (ctx?.userId !== undefined) scope.setUser({ id: String(ctx.userId) });
      scope.setExtras(extra);
      Sentry.captureException(err);
    });
  } catch {
    /* reporting must never break the request it is reporting on */
  }
}

/** Waits for queued events to be delivered — used just before the process exits after a fatal error. */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (enabled) await Sentry.flush(timeoutMs).catch(() => undefined);
}
