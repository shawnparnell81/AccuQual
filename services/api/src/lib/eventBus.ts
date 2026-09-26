import type { RedisClientType } from "redis";
import { configuredRedisUrl, createBoundedRedisClient, DEPENDENCY_TIMEOUT_MS, disconnectQuiet, withTimeout } from "./redisConnect.js";
import { logger } from "../utils/logger.js";

export const WORKFLOW_STREAM = "accuqual:workflow-events";
export const AI_STREAM = "accuqual:ai-jobs";
export const DIGITAL_TWIN_STREAM = "accuqual:digital-twin-jobs";

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType> | null = null;
let skippedLog = false;

async function getClient(): Promise<RedisClientType> {
  const url = configuredRedisUrl();
  if (!url) throw new Error("REDIS_URL is not set");
  if (client?.isOpen) return client;
  if (client) {
    await disconnectQuiet(client);
    client = null;
  }
  if (!connecting) {
    const pending = (async () => {
      const next = createBoundedRedisClient(url);
      next.on("error", (err) => logger.error("Redis client error", err));
      try {
        await withTimeout(next.connect(), DEPENDENCY_TIMEOUT_MS, "Redis");
        client = next;
        return next;
      } catch (err) {
        await disconnectQuiet(next);
        throw err;
      }
    })();
    connecting = pending.finally(() => {
      connecting = null;
    });
  }
  return connecting;
}

/**
 * Publishes an event onto a Redis Stream. Consumed by the workflow-worker,
 * ai-worker, and digital-twin-worker processes (see /workers).
 *
 * Not opened during API boot. The reporting, calibration, and training
 * schedulers talk to Postgres only. The workers are other processes; their
 * clients set reconnectStrategy to false and bound connect to 3 seconds, so
 * a missing Redis rejects there instead of retrying forever. Nothing in
 * those processes can stall this process's GET /health.
 */
export async function publishEvent(stream: string, event: Record<string, unknown>): Promise<void> {
  if (!configuredRedisUrl()) {
    if (!skippedLog) {
      skippedLog = true;
      logger.warn("REDIS_URL is not set; event bus publishes are skipped");
    }
    return;
  }
  try {
    const redis = await getClient();
    const fields = Object.entries({ ...event, publishedAt: new Date().toISOString() }).flatMap(
      ([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]
    );
    await withTimeout(redis.xAdd(stream, "*", fieldsToRecord(fields)), DEPENDENCY_TIMEOUT_MS, "Redis");
  } catch (err) {
    logger.error(`Failed to publish event to ${stream}`, err);
  }
}

function fieldsToRecord(flat: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (let i = 0; i < flat.length; i += 2) {
    record[flat[i] as string] = flat[i + 1] as string;
  }
  return record;
}

/**
 * For one-shot CLI scripts only (e.g. db/seedDemoStory.ts) that call
 * publishEvent and then need the process to actually exit — the live
 * Express server never calls this (its own process lifetime IS the
 * client's lifetime). Without this, getClient()'s lazily-opened connection
 * stays open forever, and a script that never explicitly exits hangs
 * indefinitely after all its real work is done (found live: a seed script
 * completed every insert successfully but the node process never returned,
 * because nothing ever closed this module-level client).
 */
export async function closeEventBusClient(): Promise<void> {
  const current = client;
  client = null;
  connecting = null;
  if (current) await disconnectQuiet(current);
}
