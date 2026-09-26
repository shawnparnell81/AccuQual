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
 * Small Redis Streams consumer-group helper — see /workers/README.md.
 *
 * A single bad message must never take down the whole worker — found live
 * (not in review) when this exact thing happened: an integration test
 * creates a company, queues an embed job for a record in it, then deletes
 * the company in its own cleanup before the worker got to the job, and the
 * resulting FK violation propagated straight out of this function and
 * crashed the process (nothing else consumed AI jobs again until someone
 * noticed and restarted it by hand). The message is still ack'd either way
 * — a poison message must not loop forever — but a failed handler now logs
 * and moves on to the next message instead of exiting the whole worker.
 */
export async function consumeStream(
  redisUrl: string,
  stream: string,
  group: string,
  consumerName: string,
  handler: (fields: Record<string, string>) => Promise<void>
): Promise<void> {
  const client = openRedis(redisUrl);
  await connectRedis(client);

  try {
    await client.xGroupCreate(stream, group, "0", { MKSTREAM: true });
  } catch {
    // group already exists — fine
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const response = await client.xReadGroup(group, consumerName, [{ key: stream, id: ">" }], { COUNT: 10, BLOCK: 5000 });
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
}
