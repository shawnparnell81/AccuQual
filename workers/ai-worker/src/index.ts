import "dotenv/config";
import winston from "winston";
import { consumeStream } from "./redis-consumer.js";
import { handleJob } from "./jobHandler.js";
import { startHeartbeat } from "./heartbeat.js";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.simple()),
  transports: [new winston.transports.Console()],
});

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const AI_STREAM = "accuqual:ai-jobs";

logger.info(`AccuQual ai-worker listening on ${AI_STREAM}`);
startHeartbeat("ai", REDIS_URL);
consumeStream(REDIS_URL, AI_STREAM, "ai-worker", "consumer-1", handleJob).catch((err) => {
  logger.error("ai-worker crashed", err);
  process.exit(1);
});
