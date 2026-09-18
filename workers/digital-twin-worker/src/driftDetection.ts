import winston from "winston";
import { db, aiRiskScores } from "./db.js";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.simple()),
  transports: [new winston.transports.Console()],
});

/**
 * Naive drift detector: flags a reading whose numeric fields exceed 3x the
 * running mean. The running-mean cache is keyed by tenant+device so one
 * tenant's noisy sensor never affects another tenant's baseline.
 *
 * Full-System Audit finding H6 — moved out of index.ts (unchanged logic,
 * same function) so it can be imported by test/drift-detection.test.ts
 * without also importing index.ts's own top-level consumeStream(...) call,
 * which would start a real, indefinite Redis consumer loop as an import
 * side effect.
 */
const runningMeanByTenantDevice = new Map<string, number>();

export async function handleReading(fields: Record<string, string>) {
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
