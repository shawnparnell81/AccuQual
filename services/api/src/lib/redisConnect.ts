import { createClient, type RedisClientType } from "redis";
import { env } from "../config/env.js";

/** Caps a Redis or database probe so a health check can never wait on a retry loop. */
export const DEPENDENCY_TIMEOUT_MS = 3_000;

/**
 * Blank and missing are the same: this deploy has no Redis. The private
 * Render blueprint does not set REDIS_URL. Do not substitute localhost —
 * that address is what made node-redis retry forever inside /health.
 */
export function configuredRedisUrl(): string | undefined {
  const url = env.REDIS_URL?.trim();
  return url ? url : undefined;
}

export function redisSocketOptions(): { connectTimeout: number; reconnectStrategy: false } {
  return { connectTimeout: DEPENDENCY_TIMEOUT_MS, reconnectStrategy: false };
}

export function createBoundedRedisClient(url: string): RedisClientType {
  return createClient({ url, socket: redisSocketOptions() });
}

/** Rejects when `work` is still pending after `ms`. Does not cancel `work`. */
export function withTimeout<T>(work: Promise<T>, ms = DEPENDENCY_TIMEOUT_MS, label = "Operation"): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** `quit()` waits for a reply the server will never send when the socket never opened. */
export async function disconnectQuiet(client: { disconnect: () => Promise<void> }): Promise<void> {
  await Promise.race([
    client.disconnect().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 250)),
  ]);
}
