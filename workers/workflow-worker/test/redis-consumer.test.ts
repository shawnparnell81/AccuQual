import "dotenv/config";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createClient, type RedisClientType } from "redis";
import { consumeStream } from "../src/redis-consumer.js";

/**
 * Real coverage for redis-consumer.ts — before this file, ZERO tests
 * touched the Redis Streams consumer-group logic every worker
 * (workflow-worker/ai-worker/digital-twin-worker) shares by copy. Runs
 * against a REAL Redis (REDIS_URL — same instance dev/CI already run),
 * matching this repo's "real over mocked" testing convention.
 *
 * `signal`/`blockMs` (added to consumeStream alongside this file) exist
 * purely so this otherwise-infinite consumer loop can be stopped
 * deterministically once a test has seen what it's waiting for, instead of
 * leaving a dangling background loop that would keep the vitest process
 * alive indefinitely.
 */
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

function uniqueStream(label: string) {
  return `test:redis-consumer:${label}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

/** Publishes one message and returns its id, using a throwaway client — mirrors what a real publishEvent call writes. */
async function publish(client: RedisClientType, stream: string, fields: Record<string, string>) {
  return client.xAdd(stream, "*", fields);
}

describe("consumeStream", () => {
  const publisher: RedisClientType = createClient({ url: REDIS_URL });
  const cleanupStreams: string[] = [];

  afterEach(async () => {
    for (const stream of cleanupStreams.splice(0)) {
      await publisher.del(stream).catch(() => undefined);
    }
  });

  afterAll(async () => {
    if (publisher.isOpen) await publisher.quit();
  });

  it("delivers a published message to the handler and acks it", async () => {
    if (!publisher.isOpen) await publisher.connect();
    const stream = uniqueStream("delivers");
    cleanupStreams.push(stream);
    await publish(publisher, stream, { entityId: "1", event: "closed" });

    const seen: Record<string, string>[] = [];
    const controller = new AbortController();
    const consumerDone = consumeStream(REDIS_URL, stream, "test-group", "consumer-1", async (fields) => {
      seen.push(fields);
      controller.abort();
    }, { signal: controller.signal, blockMs: 200 });

    await consumerDone;

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ entityId: "1", event: "closed" });

    const pending = await publisher.xPending(stream, "test-group");
    expect(pending.pending).toBe(0); // acked, not left redeliverable
  });

  it("does not crash the loop when a handler throws — the message is still acked and the next one is still processed (real, previously-live incident)", async () => {
    if (!publisher.isOpen) await publisher.connect();
    const stream = uniqueStream("bad-handler");
    cleanupStreams.push(stream);
    await publish(publisher, stream, { entityId: "bad" });
    await publish(publisher, stream, { entityId: "good" });

    const seen: string[] = [];
    const controller = new AbortController();
    const consumerDone = consumeStream(
      REDIS_URL,
      stream,
      "test-group",
      "consumer-1",
      async (fields) => {
        seen.push(fields.entityId as string);
        if (fields.entityId === "bad") throw new Error("simulated handler failure");
        if (seen.length >= 2) controller.abort();
      },
      { signal: controller.signal, blockMs: 200 }
    );

    await consumerDone;

    expect(seen).toEqual(["bad", "good"]);
    const pending = await publisher.xPending(stream, "test-group");
    expect(pending.pending).toBe(0); // the throwing message was still acked, not left to redeliver forever
  });

  it("is idempotent when the consumer group already exists (a second consumeStream call on the same stream/group doesn't throw)", async () => {
    if (!publisher.isOpen) await publisher.connect();
    const stream = uniqueStream("idempotent-group");
    cleanupStreams.push(stream);
    await publish(publisher, stream, { entityId: "1" });

    const controllerA = new AbortController();
    await consumeStream(REDIS_URL, stream, "shared-group", "consumer-a", async () => controllerA.abort(), {
      signal: controllerA.signal,
      blockMs: 200,
    });

    await publish(publisher, stream, { entityId: "2" });
    const controllerB = new AbortController();
    await expect(
      consumeStream(REDIS_URL, stream, "shared-group", "consumer-b", async () => controllerB.abort(), {
        signal: controllerB.signal,
        blockMs: 200,
      })
    ).resolves.toBeUndefined();
  });
});
