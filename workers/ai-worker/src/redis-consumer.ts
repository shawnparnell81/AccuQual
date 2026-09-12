import { createClient, type RedisClientType } from "redis";

/** Small Redis Streams consumer-group helper — see /workers/README.md. */
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
    const response = await client.xReadGroup(group, consumerName, [{ key: stream, id: ">" }], { COUNT: 10, BLOCK: 5000 });
    if (!response) continue;

    for (const streamResult of response) {
      for (const message of streamResult.messages) {
        try {
          await handler(message.message as Record<string, string>);
        } finally {
          await client.xAck(stream, group, message.id);
        }
      }
    }
  }
}
