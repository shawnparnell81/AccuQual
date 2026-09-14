import { createClient, type RedisClientType } from "redis";

/**
 * Small Redis Streams consumer-group helper shared by shape (each worker
 * keeps its own tiny copy rather than pulling in a cross-workspace package
 * for ~25 lines — see /workers/README.md).
 *
 * A single bad message must never take down the whole worker — found live
 * (not in review) in the ai-worker's copy of this exact file: an
 * integration test creates a tenant, queues a job for a record in it, then
 * deletes the tenant in its own cleanup before the worker got to the job,
 * and the resulting FK violation propagated straight out of this function
 * and crashed the process (nothing else got processed until someone
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
  const client: RedisClientType = createClient({ url: redisUrl });
  await client.connect();

  try {
    await client.xGroupCreate(stream, group, "0", { MKSTREAM: true });
  } catch {
    // group already exists — fine
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const response = await client.xReadGroup(
      group,
      consumerName,
      [{ key: stream, id: ">" }],
      { COUNT: 10, BLOCK: 5000 }
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
}
