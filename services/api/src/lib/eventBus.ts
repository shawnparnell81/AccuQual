import { createClient, type RedisClientType } from "redis";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

export const WORKFLOW_STREAM = "accuqual:workflow-events";
export const AI_STREAM = "accuqual:ai-jobs";
export const DIGITAL_TWIN_STREAM = "accuqual:digital-twin-jobs";

let client: RedisClientType | null = null;

async function getClient(): Promise<RedisClientType> {
  if (!client) {
    client = createClient({ url: env.REDIS_URL });
    client.on("error", (err) => logger.error("Redis client error", err));
    await client.connect();
  }
  return client;
}

/**
 * Publishes an event onto a Redis Stream. Consumed by the workflow-worker,
 * ai-worker, and digital-twin-worker processes (see /workers).
 */
export async function publishEvent(stream: string, event: Record<string, unknown>): Promise<void> {
  try {
    const redis = await getClient();
    const fields = Object.entries({ ...event, publishedAt: new Date().toISOString() }).flatMap(
      ([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]
    );
    await redis.xAdd(stream, "*", fieldsToRecord(fields));
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
  if (client) {
    await client.quit();
    client = null;
  }
}
