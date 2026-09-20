import "dotenv/config";
import winston from "winston";
import { consumeStream } from "./redis-consumer.js";
import { handleReading } from "./driftDetection.js";
import { startHeartbeat } from "./heartbeat.js";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.simple()),
  transports: [new winston.transports.Console()],
});

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const DIGITAL_TWIN_STREAM = "accuqual:digital-twin-jobs";

logger.info(`AccuQual digital-twin-worker listening on ${DIGITAL_TWIN_STREAM}`);
startHeartbeat("digital-twin", REDIS_URL);
consumeStream(REDIS_URL, DIGITAL_TWIN_STREAM, "digital-twin-worker", "consumer-1", handleReading).catch((err) => {
  logger.error("digital-twin-worker crashed", err);
  process.exit(1);
});
