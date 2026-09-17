import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { createApp } from "./app.js";
import { startReportingScheduler } from "./modules/reporting/reporting.scheduler.js";

const app = createApp();

app.listen(env.PORT, () => {
  logger.info(`AccuQual API listening on port ${env.PORT} [${env.NODE_ENV}]`);
  // Phase 6 — only the real, long-lived server process polls for due
  // scheduled reports, never the test suite (which imports createApp()
  // directly and never reaches this file) and never a one-off script.
  startReportingScheduler();
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", reason);
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down");
  process.exit(0);
});
