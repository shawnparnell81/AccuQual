import { env } from "./config/env.js";
import { initSentry, captureError, flushSentry } from "./modules/monitoring/sentry.js";
import { logger } from "./utils/logger.js";
import { createApp } from "./app.js";
import { startReportingScheduler } from "./modules/reporting/reporting.scheduler.js";
import { startHealthMonitor } from "./modules/monitoring/healthMonitor.js";
import { startCalibrationSweep } from "./modules/calibration/calibration.service.js";
import { startTrainingSweep } from "./modules/training/training.service.js";

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
  // Emails the Quality department a digest of equipment that is overdue, failed, out of service or due soon (at most one per
  // organization per 20 hours). Same rule: only the real server process, never the test suite.
  startCalibrationSweep();
  // Same for training: a digest to Quality of people who are overdue, expired, failed, or whose document has been revised.
  startTrainingSweep();
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
