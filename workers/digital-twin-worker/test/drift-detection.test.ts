import { ensureTestCompany } from "../../../services/api/test/helpers/company.js";
// Real-DB test. Full-System
// Audit finding H6: digital-twin-worker had zero test coverage at all — no
// regression protection for its drift-detection math (an exponential
// running mean, flags a reading over 3x it) or its cache-key isolation
// (the running-mean Map is keyed by device so one device's baseline can
// never leak into another's).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { handleReading, resetDriftStateForTests } from "../src/driftDetection.js";
import { db, pool, aiRiskScores, iotData, iotDevices } from "../src/db.js";

async function makeCompany(_label?: string) {
  const co = await ensureTestCompany();
  return co.id;
}

function reading(_companyId: number, deviceId: string, value: number) {
  return { event: "iot_reading", deviceId, data: JSON.stringify({ temperature: value }) };
}

describe("digital-twin-worker drift detection", () => {
  beforeEach(async () => {
    await makeCompany();
    await db.delete(aiRiskScores);
    await db.delete(iotData);
    resetDriftStateForTests();
  });

  afterAll(async () => {
    await db.delete(aiRiskScores);
    await db.delete(iotData);
    await db.delete(iotDevices);
    await pool.end();
  });

  it("the very first reading for a device only seeds the baseline — no false-positive drift alarm", async () => {
    const companyId = await makeCompany("first-reading");
    await handleReading(reading(companyId, "device-1", 100));
    const rows = await db.select().from(aiRiskScores);
    expect(rows.length).toBe(0);
  });

  it("a reading over 3x the established running mean is flagged as drift", async () => {
    const companyId = await makeCompany("real-drift");
    const deviceId = "device-1";
    // Several stable readings around 100 establish a real baseline before the spike.
    for (const v of [100, 102, 98, 101]) await handleReading(reading(companyId, deviceId, v));
    await handleReading(reading(companyId, deviceId, 500)); // ~5x baseline

    const rows = await db.select().from(aiRiskScores);
    expect(rows.length).toBe(1);
    expect(rows[0]?.entityType).toBe("iot_device");
    expect((rows[0]?.details as { deviceId?: string })?.deviceId).toBe(deviceId);
  });

  it("a reading well within normal range is never flagged", async () => {
    const companyId = await makeCompany("no-drift");
    const deviceId = "device-1";
    for (const v of [50, 51, 49, 50, 52, 48]) await handleReading(reading(companyId, deviceId, v));

    const rows = await db.select().from(aiRiskScores);
    expect(rows.length).toBe(0);
  });

  it("cache-key isolation: a device with an established high baseline does not cause a false alarm on a DIFFERENT device with a fresh low baseline", async () => {
    const companyId = await makeCompany("multi-device");
    // device-hot's own baseline is genuinely high — never itself a drift event.
    for (const v of [400, 405, 398, 402]) await handleReading(reading(companyId, "device-hot", v));
    // device-cold starts completely fresh; its first real reading (50) is
    // nowhere near device-hot's baseline, and must be judged only against
    // its OWN (nonexistent) history — if the cache were keyed by company
    // alone, this could misfire or inherit device-hot's mean.
    await handleReading(reading(companyId, "device-cold", 50));

    const rows = await db.select().from(aiRiskScores);
    expect(rows.length).toBe(0);
  });

  it("malformed or non-drift events are ignored without throwing or writing anything", async () => {
    const companyId = await makeCompany("malformed");
    await expect(handleReading({ event: "something_else", deviceId: "d1", data: "{}" })).resolves.toBeUndefined();
    await expect(handleReading({ event: "iot_reading", deviceId: "d1", data: "not json" })).resolves.toBeUndefined();
    await expect(handleReading({ event: "iot_reading", deviceId: "d1", data: JSON.stringify({ status: "ok" }) })).resolves.toBeUndefined();
    await expect(handleReading({ event: "iot_reading", deviceId: "d1", data: JSON.stringify({ temperature: 999 }) })).resolves.toBeUndefined();

    const rows = await db.select().from(aiRiskScores);
    expect(rows.length).toBe(0);
  });

  it("judges each channel on its own — a pressure spike is caught even while temperature stays perfectly steady (averaging the channels together used to hide it)", async () => {
    const companyId = await makeCompany("per-channel");
    const multi = (temperature: number, pressure: number) => ({ event: "iot_reading", deviceId: "press-1", data: JSON.stringify({ temperature, pressure }) });
    for (let i = 0; i < 4; i++) await handleReading(multi(100, 10));
    await handleReading(multi(100, 80));

    const rows = await db.select().from(aiRiskScores);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.details).toMatchObject({ deviceId: "press-1", channel: "pressure", reading: 80, direction: "up" });
  });

  it("flags a reading that collapses to under a third of its baseline (a dead sensor or a process losing pressure), not only spikes upward", async () => {
    const companyId = await makeCompany("downward");
    for (const v of [100, 102, 98, 101]) await handleReading(reading(companyId, "pump-1", v));
    await handleReading(reading(companyId, "pump-1", 10));

    const rows = await db.select().from(aiRiskScores);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.details).toMatchObject({ channel: "temperature", direction: "down" });
  });

  it("does not raise an alarm until a channel has a few readings behind it — two readings are not a baseline", async () => {
    const companyId = await makeCompany("warmup");
    for (const v of [100, 100]) await handleReading(reading(companyId, "new-1", v));
    await handleReading(reading(companyId, "new-1", 500));

    const rows = await db.select().from(aiRiskScores);
    expect(rows).toHaveLength(0);
  });

  it("writes one alert per sustained excursion, not one per reading (cooldown)", async () => {
    const companyId = await makeCompany("cooldown");
    for (const v of [100, 102, 98, 101]) await handleReading(reading(companyId, "oven-1", v));
    for (const v of [500, 600, 700]) await handleReading(reading(companyId, "oven-1", v));

    const rows = await db.select().from(aiRiskScores);
    expect(rows).toHaveLength(1);
  });

  it("links the alert to the registered device row so the UI can show its name", async () => {
    const companyId = await makeCompany("linked");
    const [device] = await db.insert(iotDevices).values({ deviceId: "kiln-7", name: "Kiln 7 thermocouple" }).returning();
    for (const v of [100, 102, 98, 101]) await handleReading(reading(companyId, "kiln-7", v));
    await handleReading(reading(companyId, "kiln-7", 500));

    const rows = await db.select().from(aiRiskScores);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entityId).toBe(device!.id);
  });

  it("rebuilds a device's baseline from its stored readings after a worker restart, so drift is still caught on the first reading afterwards", async () => {
    const companyId = await makeCompany("restart");
    const deviceId = "furnace-2";
    const base = Date.now() - 60_000;
    // Five normal readings, then the spike — all already stored, exactly as the API does BEFORE it publishes the event.
    const stored = [100, 101, 99, 100, 102, 500];
    for (let i = 0; i < stored.length; i++) {
      await db.insert(iotData).values({ deviceId, timestamp: new Date(base + i * 1000), data: { temperature: stored[i] } });
    }

    resetDriftStateForTests(); // simulate the worker restarting: no in-memory baseline at all
    await handleReading(reading(companyId, deviceId, 500));

    const rows = await db.select().from(aiRiskScores);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.details).toMatchObject({ deviceId, direction: "up", reading: 500 });
  });
});
