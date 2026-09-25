import winston from "winston";
import { and, desc, eq } from "drizzle-orm";
import { db, aiRiskScores, iotData, iotDevices } from "./db.js";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.simple()),
  transports: [new winston.transports.Console()],
});

/**
 * Drift detector. Each numeric channel of a device's readings (temperature,
 * pressure, vibration, ...) gets its OWN exponential running mean, keyed by
 * tenant + device + channel — so one tenant's noisy sensor never touches
 * another's baseline, and a spike on one channel can't hide behind a stable
 * one (the earlier version averaged every channel of a reading into a single
 * number first, which both masked real drift and mixed units).
 *
 * A reading is flagged when its magnitude is more than 3x the channel's
 * running mean (drifting up) or less than a third of it (drifting down —
 * a stuck/dead sensor or a process losing pressure), once the channel has at
 * least MIN_BASELINE_SAMPLES readings behind it. A device's very first
 * readings only establish the baseline; they never raise an alarm.
 *
 * The baseline lives in memory for speed, but the first time this process
 * sees a device it is rebuilt from that device's recently stored readings
 * (iot_data), so a worker restart no longer wipes what "normal" looks like
 * and re-learns it from scratch. A repeat alert for the same device+channel
 * is suppressed for ALERT_COOLDOWN_MS so one sustained excursion doesn't
 * write hundreds of rows.
 *
 * Full-System Audit finding H6 — kept in its own module (not index.ts) so
 * test/drift-detection.test.ts can import it without also starting
 * index.ts's real, indefinite Redis consumer loop as an import side effect.
 */
const MIN_BASELINE_SAMPLES = 3;
const DRIFT_RATIO = 3;
const ALERT_COOLDOWN_MS = 60_000;
const SEED_HISTORY_LIMIT = 20;
const EPSILON = 1e-9;

interface Baseline {
  mean: number;
  samples: number;
}

const baselines = new Map<string, Baseline>();
const seededDevices = new Set<string>();
const lastAlertAt = new Map<string, number>();

/** Tests only — the maps above are module state shared by every test in a file. */
export function resetDriftStateForTests() {
  baselines.clear();
  seededDevices.clear();
  lastAlertAt.clear();
}

function updateBaseline(key: string, value: number) {
  const existing = baselines.get(key);
  baselines.set(key, existing ? { mean: existing.mean * 0.9 + value * 0.1, samples: existing.samples + 1 } : { mean: value, samples: 1 });
}

function numericChannels(data: Record<string, unknown>): Array<[string, number]> {
  return Object.entries(data).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]));
}

/** First time this process sees a device: rebuild its baselines from the readings already stored, oldest first. */
async function seedFromHistory(tenantId: number, deviceId: string) {
  try {
    const recent = await db
      .select()
      .from(iotData)
      .where(and(eq(iotData.deviceId, deviceId)))
      .orderBy(desc(iotData.timestamp), desc(iotData.id))
      .limit(SEED_HISTORY_LIMIT + 1);
    // The API stores a reading BEFORE publishing it here, so the newest
    // stored row is the reading currently being processed — it must be
    // judged against history, not folded into it.
    for (const row of recent.slice(1).reverse()) {
      for (const [channel, value] of numericChannels((row.data ?? {}) as Record<string, unknown>)) {
        updateBaseline(`${tenantId}:${deviceId}:${channel}`, value);
      }
    }
  } catch (err) {
    logger.warn(`Could not seed drift baseline for ${deviceId} from stored readings: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function handleReading(fields: Record<string, string>) {
  if (fields.event !== "iot_reading" || !fields.tenantId || !fields.deviceId || !fields.data) return;

  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(fields.data);
  } catch {
    logger.warn(`Could not parse IoT payload for ${fields.deviceId}`);
    return;
  }

  const channels = numericChannels(data);
  if (channels.length === 0) return;

  const tenantId = Number(fields.tenantId);
  const deviceKey = `${tenantId}:${fields.deviceId}`;
  if (!seededDevices.has(deviceKey)) {
    seededDevices.add(deviceKey);
    await seedFromHistory(tenantId, fields.deviceId);
  }

  for (const [channel, value] of channels) {
    const key = `${deviceKey}:${channel}`;
    const baseline = baselines.get(key);
    const magnitude = Math.abs(value);
    const meanMagnitude = baseline ? Math.abs(baseline.mean) : 0;

    let direction: "up" | "down" | null = null;
    if (baseline && baseline.samples >= MIN_BASELINE_SAMPLES && meanMagnitude > EPSILON) {
      if (magnitude > meanMagnitude * DRIFT_RATIO) direction = "up";
      else if (magnitude < meanMagnitude / DRIFT_RATIO) direction = "down";
    }
    const meanBeforeUpdate = baseline?.mean;
    updateBaseline(key, value);

    if (!direction || meanBeforeUpdate === undefined) continue;

    const now = Date.now();
    if (now - (lastAlertAt.get(key) ?? 0) < ALERT_COOLDOWN_MS) continue;
    lastAlertAt.set(key, now);

    const factor = direction === "up" ? magnitude / meanMagnitude : meanMagnitude / Math.max(magnitude, EPSILON);
    const score = Math.min(100, 50 + Math.round(10 * (Math.min(factor, 6) - 1)));
    logger.warn(`Process drift detected on device ${fields.deviceId} channel ${channel} (tenant ${tenantId}): reading=${value} runningMean=${meanBeforeUpdate} direction=${direction}`);

    const [device] = await db
      .select({ id: iotDevices.id })
      .from(iotDevices)
      .where(and(eq(iotDevices.deviceId, fields.deviceId)));

    await db.insert(aiRiskScores).values({
      entityType: "iot_device",
      entityId: device?.id,
      score: String(score),
      details: { deviceId: fields.deviceId, channel, reading: value, runningMean: meanBeforeUpdate, direction, reason: "drift_detected" },
    });
  }
}
