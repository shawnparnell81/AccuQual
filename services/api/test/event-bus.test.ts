import { afterAll, describe, expect, it } from "vitest";
import { createClient, type RedisClientType } from "redis";
import { publishEvent, closeEventBusClient } from "../src/lib/eventBus.js";
import { env } from "../src/config/env.js";

/**
 * Real coverage for lib/eventBus.ts — before this file, ZERO tests (unit or
 * integration) touched publishEvent/consumeStream/the event bus at all,
 * despite it being the one shared choke point every Layer-2 module's
 * status-change handler calls (NCR/CAPA/documents/inventory/risk/...) to
 * feed the Workflow Engine. Runs against a REAL Redis (REDIS_URL — the same
 * instance dev and CI already provision for the workflow-worker), matching
 * this repo's own "real DB/real HTTP, not mocks" testing convention rather
 * than mocking the redis client.
 *
 * Uses a dedicated, uniquely-named test stream (never the real
 * WORKFLOW_STREAM/AI_STREAM/DIGITAL_TWIN_STREAM constants) so this can never
 * write into a stream a real workflow-worker/ai-worker/digital-twin-worker
 * might be consuming from in a shared dev environment.
 */
const TEST_STREAM = `test:event-bus:${Date.now()}`;

async function readAllMessages(client: RedisClientType, stream: string) {
  const range = await client.xRange(stream, "-", "+");
  return range.map((entry) => entry.message);
}

describe("eventBus.publishEvent", () => {
  const readerClient = createClient({ url: env.REDIS_URL });

  afterAll(async () => {
    await readerClient.del(TEST_STREAM).catch(() => undefined);
    await readerClient.quit();
    await closeEventBusClient();
  });

  it("writes a real, readable entry onto the given Redis stream", async () => {
    await readerClient.connect();
    await publishEvent(TEST_STREAM, { tenantId: 42, module: "ncr", event: "closed", entityId: 7 });

    const messages = await readAllMessages(readerClient, TEST_STREAM);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ tenantId: "42", module: "ncr", event: "closed", entityId: "7" });
    expect(messages[0]?.publishedAt).toBeTruthy();
  });

  it("JSON-stringifies non-string field values instead of writing [object Object]", async () => {
    await publishEvent(TEST_STREAM, { supplierId: 5, results: { riskHeatmap: [{ nodeId: "m1", riskScore: 0.4 }] } });

    const messages = await readAllMessages(readerClient, TEST_STREAM);
    const written = messages[messages.length - 1];
    expect(written?.results).toBe(JSON.stringify({ riskHeatmap: [{ nodeId: "m1", riskScore: 0.4 }] }));
  });

  it("stamps every published event with its own publishedAt, even across two calls", async () => {
    await publishEvent(TEST_STREAM, { entityId: 1 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await publishEvent(TEST_STREAM, { entityId: 2 });

    const messages = await readAllMessages(readerClient, TEST_STREAM);
    const lastTwo = messages.slice(-2);
    expect(lastTwo[0]?.publishedAt).not.toBe(lastTwo[1]?.publishedAt);
  });

  it("never throws when the target stream name is otherwise unused (fresh stream, no prior XADD)", async () => {
    const freshStream = `${TEST_STREAM}:fresh`;
    await expect(publishEvent(freshStream, { entityId: 99 })).resolves.toBeUndefined();
    await readerClient.del(freshStream);
  });
});
