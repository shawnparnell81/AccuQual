import { env } from "./config/env.js";
import { initSentry, captureError, flushSentry } from "./modules/monitoring/sentry.js";
import { logger } from "./utils/logger.js";
import { createApp } from "./app.js";
import { startReportingScheduler } from "./modules/reporting/reporting.scheduler.js";
import { startHealthMonitor } from "./modules/monitoring/healthMonitor.js";

// Before anything else can fail, so start-up errors are reported too.
initSentry();

const app = createApp();

app.listen(env.PORT, () => {
  logger.info(`AccuQual API listening on port ${env.PORT} [${env.NODE_ENV}]`);
  // Phase 6 — only the real, long-lived server process polls for due
  // scheduled reports, never the test suite (which imports createApp()
  // directly and never reaches this file) and never a one-off script.
  startReportingScheduler();
  // Same reasoning — real deployment monitoring/alerting, only the real
  // server process runs it.
  startHealthMonitor();
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", reason);
  captureError(reason, { kind: "unhandledRejection" });
});

// A synchronous exception nobody caught leaves the process in an unknown state. Report it, then exit non-zero so the
// supervisor (Render / Docker) restarts a clean process — carrying on after one is how a bug becomes corrupted data.
process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception — exiting", { message: err.message, stack: err.stack });
  captureError(err, { kind: "uncaughtException" });
  void flushSentry().finally(() => process.exit(1));
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down");
  void flushSentry().finally(() => process.exit(0));
});
