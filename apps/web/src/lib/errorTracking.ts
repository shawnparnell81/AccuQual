/**
 * Browser error tracking (opt-in). With VITE_SENTRY_DSN unset nothing is loaded — the Sentry code is a separate chunk
 * that is only fetched when a DSN is configured at build time. What is sent: the error, its stack, the page path
 * (never the query string) and the app version. Not sent: cookies, form values, request bodies, IP addresses, session
 * recordings. A quality system's screens are full of customers' records; a stack trace is enough to fix a bug.
 */
type SentryModule = typeof import("@sentry/react");
let sentry: SentryModule | null = null;

export function initErrorTracking(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  void import("@sentry/react").then((mod) => {
    mod.init({
      dsn,
      environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) ?? import.meta.env.MODE,
      release: import.meta.env.VITE_APP_VERSION as string | undefined,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      integrations: [], // no replay, no breadcrumbs of clicks/inputs
      beforeSend(event) {
        if (event.request?.url) event.request.url = event.request.url.split("?")[0]!;
        delete event.request?.cookies;
        delete event.user;
        return event;
      },
      ignoreErrors: ["ResizeObserver loop limit exceeded", "ResizeObserver loop completed with undelivered notifications."],
    });
    sentry = mod;
  });
}

/** Reports a caught error (e.g. from the error boundary). Silent when tracking is off. */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  sentry?.captureException(error, { extra: context });
}
