import "dotenv/config";
import winston from "winston";
import { consumeStream } from "./redis-consumer.js";
import { db, aiRiskScores } from "./db.js";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.simple()),
  transports: [new winston.transports.Console()],
});

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const DIGITAL_TWIN_STREAM = "accuqual:digital-twin-jobs";

/**
 * Naive drift detector: flags a reading whose numeric fields exceed 3x the
 * running mean. The running-mean cache is keyed by tenant+device so one
 * tenant's noisy sensor never affects another tenant's baseline.
 */
const runningMeanByTenantDevice = new Map<string, number>();

async function handleReading(fields: Record<string, string>) {
  if (fields.event !== "iot_reading" || !fields.tenantId || !fields.deviceId || !fields.data) return;

  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(fields.data);
  } catch {
    logger.warn(`Could not parse IoT payload for ${fields.deviceId}`);
    return;
  }

  const numericValues = Object.values(data).filter((v): v is number => typeof v === "number");
  if (numericValues.length === 0) return;

  const cacheKey = `${fields.tenantId}:${fields.deviceId}`;
  const reading = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
  const runningMean = runningMeanByTenantDevice.get(cacheKey) ?? reading;
  runningMeanByTenantDevice.set(cacheKey, runningMean * 0.9 + reading * 0.1);

  if (runningMean > 0 && reading > runningMean * 3) {
    logger.warn(`Process drift detected on device ${fields.deviceId} (tenant ${fields.tenantId}): reading=${reading} runningMean=${runningMean}`);
    await db.insert(aiRiskScores).values({
      tenantId: Number(fields.tenantId),
      entityType: "iot_device",
      score: "75",
      details: { deviceId: fields.deviceId, reading, runningMean, reason: "drift_detected" },
    });
  }
}

logger.info(`AccuQual digital-twin-worker listening on ${DIGITAL_TWIN_STREAM}`);
consumeStream(REDIS_URL, DIGITAL_TWIN_STREAM, "digital-twin-worker", "consumer-1", handleReading).catch((err) => {
  logger.error("digital-twin-worker crashed", err);
  process.exit(1);
});
