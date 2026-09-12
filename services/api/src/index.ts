import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { createApp } from "./app.js";

const app = createApp();

app.listen(env.PORT, () => {
  logger.info(`AccuQual API listening on port ${env.PORT} [${env.NODE_ENV}]`);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", reason);
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down");
  process.exit(0);
});
