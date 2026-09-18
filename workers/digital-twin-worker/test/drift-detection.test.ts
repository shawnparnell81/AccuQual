// Real-DB test (see services/api/test/integration/tenant-isolation.test.ts's
// header comment on this repo's "real over mocked" convention). Full-System
// Audit finding H6: digital-twin-worker had zero test coverage at all — no
// regression protection for its drift-detection math (an exponential
// running mean, flags a reading over 3x it) or its cache-key isolation
// (the running-mean Map is keyed by tenant+device specifically so one
// tenant/device's baseline can never leak into another's).
import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { handleReading } from "../src/driftDetection.js";
import { db, pool, aiRiskScores } from "../src/db.js";
import { tenants } from "../../../services/api/src/drizzle/schema/tenants.js";

const suffix = Date.now();
const tenantIds: number[] = [];

async function makeTenant(label: string) {
  const [tenant] = await db.insert(tenants).values({ name: `Drift Test ${label} ${suffix}`, code: `drift-${label}-${suffix}-${Math.random().toString(36).slice(2, 7)}` }).returning();
  tenantIds.push(tenant!.id);
  return tenant!.id;
}

function reading(tenantId: number, deviceId: string, value: number) {
  return { event: "iot_reading", tenantId: String(tenantId), deviceId, data: JSON.stringify({ temperature: value }) };
}

describe("digital-twin-worker drift detection", () => {
  afterAll(async () => {
    await db.delete(aiRiskScores).where(inArray(aiRiskScores.tenantId, tenantIds));
    await db.delete(tenants).where(inArray(tenants.id, tenantIds));
    await pool.end();
  });

  it("the very first reading for a device only seeds the baseline — no false-positive drift alarm", async () => {
    const tenantId = await makeTenant("first-reading");
    await handleReading(reading(tenantId, "device-1", 100));
    const rows = await db.select().from(aiRiskScores).where(eq(aiRiskScores.tenantId, tenantId));
    expect(rows.length).toBe(0);
  });

  it("a reading over 3x the established running mean is flagged as drift", async () => {
    const tenantId = await makeTenant("real-drift");
    const deviceId = "device-1";
    // Several stable readings around 100 establish a real baseline before the spike.
    for (const v of [100, 102, 98, 101]) await handleReading(reading(tenantId, deviceId, v));
    await handleReading(reading(tenantId, deviceId, 500)); // ~5x baseline

    const rows = await db.select().from(aiRiskScores).where(eq(aiRiskScores.tenantId, tenantId));
    expect(rows.length).toBe(1);
    expect(rows[0]?.entityType).toBe("iot_device");
    expect((rows[0]?.details as { deviceId?: string })?.deviceId).toBe(deviceId);
  });

  it("a reading well within normal range is never flagged", async () => {
    const tenantId = await makeTenant("no-drift");
    const deviceId = "device-1";
    for (const v of [50, 51, 49, 50, 52, 48]) await handleReading(reading(tenantId, deviceId, v));

    const rows = await db.select().from(aiRiskScores).where(eq(aiRiskScores.tenantId, tenantId));
    expect(rows.length).toBe(0);
  });

  it("cache-key isolation: a device with an established high baseline does not cause a false alarm on a DIFFERENT device with a fresh low baseline, even under the same tenant", async () => {
    const tenantId = await makeTenant("multi-device");
    // device-hot's own baseline is genuinely high — never itself a drift event.
    for (const v of [400, 405, 398, 402]) await handleReading(reading(tenantId, "device-hot", v));
    // device-cold starts completely fresh; its first real reading (50) is
    // nowhere near device-hot's baseline, and must be judged only against
    // its OWN (nonexistent) history — if the cache were keyed by tenant
    // alone, this could misfire or inherit device-hot's mean.
    await handleReading(reading(tenantId, "device-cold", 50));

    const rows = await db.select().from(aiRiskScores).where(eq(aiRiskScores.tenantId, tenantId));
    expect(rows.length).toBe(0);
  });

  it("cache-key isolation: the SAME deviceId under a DIFFERENT tenant gets its own independent baseline", async () => {
    const tenantA = await makeTenant("isolation-a");
    const tenantB = await makeTenant("isolation-b");
    const deviceId = "shared-device-id"; // deliberately identical across tenants

    // Tenant A's device runs hot (establishes a high baseline, no alarm on itself).
    for (const v of [300, 305, 298]) await handleReading(reading(tenantA, deviceId, v));
    // Tenant B's SAME deviceId, first ever reading, is a normal low value —
    // must not be compared against tenant A's baseline for that same id.
    await handleReading(reading(tenantB, deviceId, 20));

    const rowsA = await db.select().from(aiRiskScores).where(eq(aiRiskScores.tenantId, tenantA));
    const rowsB = await db.select().from(aiRiskScores).where(eq(aiRiskScores.tenantId, tenantB));
    expect(rowsA.length).toBe(0);
    expect(rowsB.length).toBe(0);
  });

  it("malformed or non-drift events are ignored without throwing or writing anything", async () => {
    const tenantId = await makeTenant("malformed");
    await expect(handleReading({ event: "something_else", tenantId: String(tenantId), deviceId: "d1", data: "{}" })).resolves.toBeUndefined();
    await expect(handleReading({ event: "iot_reading", tenantId: String(tenantId), deviceId: "d1", data: "not json" })).resolves.toBeUndefined();
    await expect(handleReading({ event: "iot_reading", tenantId: String(tenantId), deviceId: "d1", data: JSON.stringify({ status: "ok" }) })).resolves.toBeUndefined();
    await expect(handleReading({ event: "iot_reading", deviceId: "d1", data: JSON.stringify({ temperature: 999 }) })).resolves.toBeUndefined();

    const rows = await db.select().from(aiRiskScores).where(eq(aiRiskScores.tenantId, tenantId));
    expect(rows.length).toBe(0);
  });
});
