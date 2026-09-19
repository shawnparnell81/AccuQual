// Real-DB test (see services/api/test/integration/tenant-isolation.test.ts's
// header comment on this repo's "real over mocked" convention). Full-System
// Audit finding H6: digital-twin-worker had zero test coverage at all — no
// regression protection for its drift-detection math (an exponential
// running mean, flags a reading over 3x it) or its cache-key isolation
// (the running-mean Map is keyed by tenant+device specifically so one
// tenant/device's baseline can never leak into another's).
import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { handleReading, resetDriftStateForTests } from "../src/driftDetection.js";
import { db, pool, aiRiskScores, iotData, iotDevices } from "../src/db.js";
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
    await db.delete(iotData).where(inArray(iotData.tenantId, tenantIds));
    await db.delete(iotDevices).where(inArray(iotDevices.tenantId, tenantIds));
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

  it("judges each channel on its own — a pressure spike is caught even while temperature stays perfectly steady (averaging the channels together used to hide it)", async () => {
    const tenantId = await makeTenant("per-channel");
    const multi = (temperature: number, pressure: number) => ({ event: "iot_reading", tenantId: String(tenantId), deviceId: "press-1", data: JSON.stringify({ temperature, pressure }) });
    for (let i = 0; i < 4; i++) await handleReading(multi(100, 10));
    await handleReading(multi(100, 80));

    const rows = await db.select().from(aiRiskScores).where(eq(aiRiskScores.tenantId, tenantId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.details).toMatchObject({ deviceId: "press-1", channel: "pressure", reading: 80, direction: "up" });
  });

  it("flags a reading that collapses to under a third of its baseline (a dead sensor or a process losing pressure), not only spikes upward", async () => {
    const tenantId = await makeTenant("downward");
    for (const v of [100, 102, 98, 101]) await handleReading(reading(tenantId, "pump-1", v));
    await handleReading(reading(tenantId, "pump-1", 10));

    const rows = await db.select().from(aiRiskScores).where(eq(aiRiskScores.tenantId, tenantId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.details).toMatchObject({ channel: "temperature", direction: "down" });
  });

  it("does not raise an alarm until a channel has a few readings behind it — two readings are not a baseline", async () => {
    const tenantId = await makeTenant("warmup");
    for (const v of [100, 100]) await handleReading(reading(tenantId, "new-1", v));
    await handleReading(reading(tenantId, "new-1", 500));

    const rows = await db.select().from(aiRiskScores).where(eq(aiRiskScores.tenantId, tenantId));
    expect(rows).toHaveLength(0);
  });

  it("writes one alert per sustained excursion, not one per reading (cooldown)", async () => {
    const tenantId = await makeTenant("cooldown");
    for (const v of [100, 102, 98, 101]) await handleReading(reading(tenantId, "oven-1", v));
    for (const v of [500, 600, 700]) await handleReading(reading(tenantId, "oven-1", v));

    const rows = await db.select().from(aiRiskScores).where(eq(aiRiskScores.tenantId, tenantId));
    expect(rows).toHaveLength(1);
  });

  it("links the alert to the registered device row so the UI can show its name", async () => {
    const tenantId = await makeTenant("linked");
    const [device] = await db.insert(iotDevices).values({ tenantId, deviceId: "kiln-7", name: "Kiln 7 thermocouple" }).returning();
    for (const v of [100, 102, 98, 101]) await handleReading(reading(tenantId, "kiln-7", v));
    await handleReading(reading(tenantId, "kiln-7", 500));

    const rows = await db.select().from(aiRiskScores).where(eq(aiRiskScores.tenantId, tenantId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entityId).toBe(device!.id);
  });

  it("rebuilds a device's baseline from its stored readings after a worker restart, so drift is still caught on the first reading afterwards", async () => {
    const tenantId = await makeTenant("restart");
    const deviceId = "furnace-2";
    const base = Date.now() - 60_000;
    // Five normal readings, then the spike — all already stored, exactly as the API does BEFORE it publishes the event.
    const stored = [100, 101, 99, 100, 102, 500];
    for (let i = 0; i < stored.length; i++) {
      await db.insert(iotData).values({ tenantId, deviceId, timestamp: new Date(base + i * 1000), data: { temperature: stored[i] } });
    }

    resetDriftStateForTests(); // simulate the worker restarting: no in-memory baseline at all
    await handleReading(reading(tenantId, deviceId, 500));

    const rows = await db.select().from(aiRiskScores).where(eq(aiRiskScores.tenantId, tenantId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.details).toMatchObject({ deviceId, direction: "up", reading: 500 });
  });
});
