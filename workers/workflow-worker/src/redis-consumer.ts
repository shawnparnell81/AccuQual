import { createClient, type RedisClientType } from "redis";

const REDIS_CONNECT_TIMEOUT_MS = 3_000;

/** node-redis retries forever unless reconnectStrategy is false. connectTimeout alone never rejects that loop. */
export function openRedis(url: string): RedisClientType {
  return createClient({
    url,
    socket: { connectTimeout: REDIS_CONNECT_TIMEOUT_MS, reconnectStrategy: false },
  });
}

export async function connectRedis(client: RedisClientType): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Redis connect timed out after ${REDIS_CONNECT_TIMEOUT_MS}ms`)), REDIS_CONNECT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Small Redis Streams consumer-group helper shared by shape (each worker
 * keeps its own tiny copy rather than pulling in a cross-workspace package
 * for ~25 lines — see /workers/README.md).
 *
 * A single bad message must never take down the whole worker — found live
 * (not in review) in the ai-worker's copy of this exact file: an
 * integration test creates a company, queues a job for a record in it, then
 * deletes the company in its own cleanup before the worker got to the job,
 * and the resulting FK violation propagated straight out of this function
 * and crashed the process (nothing else got processed until someone
 * noticed and restarted it by hand). The message is still ack'd either way
 * — a poison message must not loop forever — but a failed handler now logs
 * and moves on to the next message instead of exiting the whole worker.
 */
/**
 * `signal`/`blockMs` exist purely for testability (see redis-consumer.test.ts)
 * — no production caller (this worker's own index.ts) passes either, so
 * `signal` stays undefined and the loop condition below is always true
 * exactly as before, and `blockMs` keeps its original 5000ms default. A
 * real test needs some way to stop this otherwise-infinite loop and shrink
 * its 5s blocking read so the suite doesn't hang; production behavior is
 * unchanged either way.
 */
export async function consumeStream(
  redisUrl: string,
  stream: string,
  group: string,
  consumerName: string,
  handler: (fields: Record<string, string>) => Promise<void>,
  options?: { signal?: AbortSignal; blockMs?: number }
): Promise<void> {
  const client = openRedis(redisUrl);
  await connectRedis(client);

  try {
    await client.xGroupCreate(stream, group, "0", { MKSTREAM: true });
  } catch {
    // group already exists — fine
  }

  try {
    while (!options?.signal?.aborted) {
      const response = await client.xReadGroup(
        group,
        consumerName,
        [{ key: stream, id: ">" }],
        { COUNT: 10, BLOCK: options?.blockMs ?? 5000 }
      );

      if (!response) continue;

      for (const streamResult of response) {
        for (const message of streamResult.messages) {
          try {
            await handler(message.message as Record<string, string>);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`[${stream}] handler failed for message ${message.id} — skipping, worker stays up`, err);
          } finally {
            await client.xAck(stream, group, message.id);
          }
        }
      }
    }
  } finally {
    if (options?.signal) await client.quit();
  }
}
